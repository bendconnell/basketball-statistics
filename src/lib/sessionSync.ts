import { applyOperation } from "../../shared/reducer";
import { parseOperation, sessionMetadataSchema, sessionStateSchema } from "../../shared/session";
import type { LoadedSession, OperationInput, SessionState } from "../../shared/session";

export type OperationCommand = OperationInput extends infer T ? T extends OperationInput ? Pick<T, "type" | "payload"> : never : never;
export type SaveStatus = "saved" | "saving" | "offline" | "conflict" | "error";
interface Journal { base: LoadedSession; operations: OperationInput[] }
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class SessionSync {
  readonly key: string;
  state: SessionState;
  status: SaveStatus = "saved";
  lastSavedAt: string;
  error = "";
  private journal: Journal;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private recovering = false;
  private loadedRevision: number;
  constructor(loaded: LoadedSession, readonly userId: string, private storage: Storage,
    private write: (id: string, operation: OperationInput) => Promise<{ revision: number }>) {
    loaded = { session: sessionMetadataSchema.parse(loaded.session), state: sessionStateSchema.parse(loaded.state) };
    this.loadedRevision = loaded.session.revision;
    if (loaded.session.masterUserId !== userId) throw Error("Session does not belong to the signed-in master.");
    this.key = `bball-stats.outbox.v1:${encodeURIComponent(userId)}:${loaded.session.id}`;
    this.journal = { base: loaded, operations: [] };
    const raw = storage.getItem(this.key);
    if (raw) {
      const saved = JSON.parse(raw) as Journal;
      saved.base.session = sessionMetadataSchema.parse(saved.base.session);
      saved.base.state = sessionStateSchema.parse(saved.base.state);
      if (saved.base.session.id !== loaded.session.id || saved.base.session.masterUserId !== userId) throw Error("Invalid outbox identity.");
      saved.operations = saved.operations.map(parseOperation);
      if (saved.operations.length) this.journal = saved;
    }
    this.state = this.replay();
    this.lastSavedAt = this.journal.base.session.updatedAt;
    if (this.journal.operations.length) { this.status = "saving"; this.recovering = true; }
  }
  get pending() { return this.journal.operations.length; }
  get revision() { return this.journal.base.session.revision + this.pending; }
  get blocked() { return this.recovering || this.status === "conflict" || this.status === "error" || this.disposed; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { if (!this.disposed) this.listeners.forEach(listener => listener()); }
  private context(op: OperationInput) { return { sessionId: this.journal.base.session.id, actorUserId: this.userId, revision: op.expectedRevision + 1, timestamp: this.journal.base.session.updatedAt }; }
  private replay() {
    return this.journal.operations.reduce((state, op) => {
      if (op.expectedRevision !== this.journal.base.session.revision + this.journal.operations.indexOf(op)) throw Error("Invalid outbox revision sequence.");
      return applyOperation(state, op, this.context(op));
    }, this.journal.base.state);
  }
  enqueue(command: OperationCommand) {
    if (this.blocked) throw Error(this.error || "Resolve the save error before making more changes.");
    const op = parseOperation({ ...command, operationId: crypto.randomUUID(), expectedRevision: this.revision });
    const next = applyOperation(this.state, op, this.context(op));
    const journal = { ...this.journal, operations: [...this.journal.operations, op] };
    // Persist BEFORE showing a successful local mutation. Storage failures never silently lose data.
    try { this.storage.setItem(this.key, JSON.stringify(journal)); }
    catch (e) { this.status = "error"; this.error = e instanceof Error ? e.message : "Device storage unavailable."; this.notify(); throw e; }
    this.journal = journal; this.state = next; this.status = "saving"; this.error = ""; this.notify();
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, 500);
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    this.flight = this.drain().finally(() => { this.flight = null; });
    return this.flight;
  }
  private async drain() {
    if (this.disposed || this.status === "conflict" || this.status === "error") return false;
    while (this.journal.operations.length && !this.disposed) {
      const op = this.journal.operations[0];
      let storageFailed = false;
      this.status = "saving"; this.notify();
      try {
        const result = await this.write(this.journal.base.session.id, op);
        if (result.revision !== op.expectedRevision + 1) throw Error("Unexpected server revision.");
        const next = { base: { session: { ...this.journal.base.session, revision: result.revision }, state: applyOperation(this.journal.base.state, op, this.context(op)) }, operations: this.journal.operations.slice(1) };
        try { this.storage.setItem(this.key, JSON.stringify(next)); }
        catch (e) { storageFailed = true; throw e; }
        this.journal = next;
        // The time this device received and durably recorded the acknowledgement.
        this.lastSavedAt = new Date().toISOString();
      } catch (e) {
        const status = (e as { status?: number }).status;
        this.status = storageFailed ? "error" : status === 409 || status === 412 ? "conflict" : status && status < 500 ? "error" : "offline";
        this.error = e instanceof Error ? e.message : "Unable to save."; this.notify(); return false;
      }
    }
    if (this.disposed) return false;
    this.recovering = false;
    if (this.journal.base.session.revision < this.loadedRevision) {
      this.status = "conflict"; this.error = "Pending retries were resolved, but the server has newer changes. Reload the saved record before editing."; this.notify(); return false;
    }
    this.status = "saved"; this.error = ""; this.notify(); return true;
  }
  retry() { if (this.status === "error") this.status = "offline"; return this.flush(); }
  exportPending() { return JSON.stringify(this.journal, null, 2); }
  discardPending() { if (this.flight) throw Error("Wait for the current save to finish."); this.storage.removeItem(this.key); }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); return this.flight?.then(() => undefined) ?? Promise.resolve(); }
}