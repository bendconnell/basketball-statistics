import { TableClient, odata, type TransactionAction } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { HttpError } from "./errors.js";
import type { LoadedSession } from "../../shared/session.js";

export type TableName = "CompetitionData" | "SessionOperations";
export type Row = {
  partitionKey: string; rowKey: string; etag?: string; json: string;
  kind: string; revision?: number; masterUserId?: string; gameId?: string;
};
export type Action = { type: "insert" | "replace"; row: Row; etag?: string };
export type RowFilter = { partitionKey?: string; kind?: string; gameId?: string; masterUserId?: string };
export interface Repository {
  get(table: TableName, partition: string, key: string): Promise<Row | null>;
  list(table: TableName, filter: RowFilter): Promise<Row[]>;
  transact(table: TableName, actions: Action[]): Promise<void>;
  checkpoint(snapshot: LoadedSession): Promise<void>;
}
function status(error: unknown): number | undefined { return (error as { statusCode?: number })?.statusCode; }
export class AzureRepository implements Repository {
  private tables: Record<TableName, TableClient>;
  private blobs;
  constructor(connectionString: string) {
    this.tables = {
      CompetitionData: TableClient.fromConnectionString(connectionString, "CompetitionData"),
      SessionOperations: TableClient.fromConnectionString(connectionString, "SessionOperations")
    };
    this.blobs = BlobServiceClient.fromConnectionString(connectionString).getContainerClient("game-sessions");
  }
  async get(table: TableName, partitionKey: string, rowKey: string): Promise<Row | null> {
    try { return await this.tables[table].getEntity<Row>(partitionKey, rowKey); }
    catch (e) { if (status(e) === 404) return null; throw e; }
  }
  async list(table: TableName, filter: RowFilter): Promise<Row[]> {
    const clauses: string[] = [];
    if (filter.partitionKey !== undefined) clauses.push(odata`PartitionKey eq ${filter.partitionKey}`);
    if (filter.kind !== undefined) clauses.push(odata`kind eq ${filter.kind}`);
    if (filter.gameId !== undefined) clauses.push(odata`gameId eq ${filter.gameId}`);
    if (filter.masterUserId !== undefined) clauses.push(odata`masterUserId eq ${filter.masterUserId}`);
    const result: Row[] = [];
    for await (const row of this.tables[table].listEntities<Row>({ queryOptions: { filter: clauses.join(" and ") } })) result.push(row);
    return result;
  }
  async transact(table: TableName, actions: Action[]): Promise<void> {
    const transaction: TransactionAction[] = actions.map(a => {
      const { etag: _etag, ...entity } = a.row;
      if (a.type === "insert") return ["create", entity];
      if (!a.etag || a.etag === "*") throw new Error("Conditional ETag required");
      return ["update", entity, "Replace", { etag: a.etag }];
    });
    try { await this.tables[table].submitTransaction(transaction); }
    catch (e) {
      if (status(e) === 409 || status(e) === 412) throw new HttpError(409, "conflict", "Concurrent change; reload and retry");
      throw e;
    }
  }
  async checkpoint(snapshot: LoadedSession): Promise<void> {
    const blob = this.blobs.getBlockBlobClient(`${snapshot.session.id}/snapshot.json`);
    // Read-modify-CAS, not last-writer-wins. A slow writer cannot regress a checkpoint.
    for (let attempt = 0; attempt < 3; attempt++) {
      let etag: string | undefined;
      try {
        // Fetch ETag and content together, not separate getProperties (TOCTOU).
        const response = await blob.download();
        const chunks: Buffer[] = [];
        for await (const chunk of response.readableStreamBody!) chunks.push(Buffer.from(chunk));
        const current = JSON.parse(Buffer.concat(chunks).toString("utf8")) as LoadedSession;
        if (current.session.revision >= snapshot.session.revision) return;
        etag = response.etag;
        if (!etag) throw new Error("Checkpoint ETag unavailable");
      } catch (e) { if (status(e) !== 404) throw e; }
      try {
        const bytes = Buffer.from(JSON.stringify(snapshot));
        await blob.upload(bytes, bytes.length, {
          conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
          blobHTTPHeaders: { blobContentType: "application/json" }
        });
        return;
      } catch (e) { if (status(e) !== 409 && status(e) !== 412) throw e; }
    }
    throw new Error("Checkpoint conflict; operation log remains authoritative");
  }
}
// Test adapter: copy-on-write transaction mimics ETags, unique keys and partition atomicity.
export class MemoryRepository implements Repository {
  private rows = new Map<string, Row>();
  private version = 0;
  readonly snapshots = new Map<string, LoadedSession>();
  checkpointFailure = false;
  private key(table: TableName, p: string, r: string) { return `${table}\0${p}\0${r}`; }
  async get(table: TableName, p: string, r: string) { const row = this.rows.get(this.key(table, p, r)); return row ? structuredClone(row) : null; }
  async list(table: TableName, filter: RowFilter) {
    return [...this.rows.entries()].filter(([key, row]) => key.startsWith(`${table}\0`) && Object.entries(filter).every(([field, value]) => row[field as keyof Row] === value)).map(([, row]) => structuredClone(row));
  }
  async transact(table: TableName, actions: Action[]) {
    if (!actions.length || actions.length > 100 || new Set(actions.map(a => a.row.partitionKey)).size !== 1) throw new Error("Invalid transaction partition");
    if (new Set(actions.map(a => a.row.rowKey)).size !== actions.length) throw new Error("Duplicate transaction key");
    const next = new Map(this.rows);
    for (const a of actions) {
      const key = this.key(table, a.row.partitionKey, a.row.rowKey), old = next.get(key);
      if (a.type === "insert" ? !!old : !old || !a.etag || a.etag === "*" || old.etag !== a.etag) throw new HttpError(409, "conflict", "Concurrent change; reload and retry");
      next.set(key, { ...structuredClone(a.row), etag: `W/"${++this.version}"` });
    }
    this.rows = next;
  }
  async checkpoint(snapshot: LoadedSession) {
    if (this.checkpointFailure) throw new Error("Simulated blob failure");
    if ((this.snapshots.get(snapshot.session.id)?.session.revision ?? -1) < snapshot.session.revision) this.snapshots.set(snapshot.session.id, structuredClone(snapshot));
  }
}