import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, request } from "./lib/api";
import type { CloudCompetition, CloudGame } from "./lib/api";
import type { LocalAccount } from "./lib/competitions";
import type { SessionMetadata } from "../shared/session";
import { SessionSync } from "./lib/sessionSync";
import type { OperationCommand } from "./lib/sessionSync";
import { changeLineup } from "./lib/lineups";
import type { EventDraft, Player, PossessionSide, ScoreAssist } from "./types";
import { CandidateConsole } from "./candidates/CandidateConsole";
import { CandidateGrid } from "./candidates/CandidateGrid";
import { ConfigurationTab } from "./candidates/ConfigurationTab";
import { SubstitutionsTab } from "./candidates/SubstitutionsTab";
import { LineupDifferential } from "./candidates/LineupDifferential";
import { IndividualDifferential } from "./candidates/IndividualDifferential";
import { totalPointsFor, totalPointsAgainst, totalTurnovers, totalOffensiveRebounds, totalOppositionRebounds } from "./lib/metrics";

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
interface Props { account: LocalAccount; session: SessionMetadata; game: CloudGame; competition: CloudCompetition; onExit: () => void }
export function CloudGameTracker(props: Props) {
  const [sync, setSync] = useState<SessionSync | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true; let controller: SessionSync | undefined; let release: (() => void) | undefined;
    if (!navigator.locks) { setError("Cloud editing requires a browser with Web Locks support (current Edge, Chrome, Firefox or Safari)."); return; }
    // Hold the lock through the last in-flight acknowledgement, including unmount.
    void navigator.locks.request(`bball-stats.editor:${props.account.id}:${props.session.id}`, { ifAvailable: true }, async lock => {
      if (!live) return;
      if (!lock) { setError("This session is already open in another tab. Close that editor before resuming here."); return; }
      const held = new Promise<void>(resolve => { release = resolve; });
      try {
        const loaded = await api.loadSession(props.session.id);
        if (live) { controller = new SessionSync(loaded, props.account.id, localStorage, api.writeOperation); setSync(controller); }
      } catch (e) { if (live) setError((e as Error).message); release?.(); }
      await held;
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; void (controller?.dispose() ?? Promise.resolve()).finally(() => release?.()); };
  }, [props.session.id, props.account.id, version]);
  if (error) return <div className="app-shell"><p role="alert" className="lineup-error">{error}</p><button type="button" onClick={props.onExit}>← Sessions</button><button type="button" onClick={() => { setError(""); setVersion(v => v + 1); }}>Retry load</button></div>;
  if (!sync) return <div className="app-shell"><p role="status">Loading saved session…</p></div>;
  return <SessionView key={`${props.session.id}-${version}`} {...props} sync={sync} onReload={() => { setSync(null); setVersion(v => v + 1); }} />;
}

function SessionView({ account, game, competition, onExit, sync, onReload }: Props & { sync: SessionSync; onReload: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [, render] = useState(0);
  const [error, setError] = useState("");
  const [reviewId, setReviewId] = useState(sync.state.possessions.at(-1)!.id);
  const draftKey = `${sync.key}:setup-draft`;
  const [savedDraft] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (!sync.state.sessionStarted && raw && Array.isArray(raw.roster) && Array.isArray(raw.starters)
        && raw.roster.every((p: Player) => typeof p.id === "string" && typeof p.name === "string") && raw.starters.every((id: unknown) => typeof id === "string")) {
        return { roster: raw.roster.map((p: Player) => ({ ...p, number: p.number === null ? NaN : p.number })) as Player[], starters: raw.starters as string[] };
      }
    } catch { /* Keep the invalid draft untouched for manual recovery. */ }
    return null;
  });
  const [draftRoster, setDraftRoster] = useState<Player[]>(savedDraft?.roster ?? sync.state.roster);
  const [starters, setStarters] = useState<string[]>(savedDraft?.starters ?? sync.state.startingLineupsByQuarter[1] ?? []);
  const [seconds, setSeconds] = useState(sync.state.clockSeconds);
  const [clockReady, setClockReady] = useState(false);
  const secondsRef = useRef(seconds);
  const [nudge, setNudge] = useState(0);
  const [chooseSide, setChooseSide] = useState(false);
  const startSideDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = startSideDialog.current;
    if (!dialog) return;
    if (chooseSide && !dialog.open) dialog.showModal();
    else if (!chooseSide && dialog.open) dialog.close();
  }, [chooseSide]);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const state = sync.state;
  const active = state.possessions.at(-1)!;
  const currentClock = clock(seconds);
  const command = (op: OperationCommand) => {
    try { sync.enqueue(op); setError(""); return true; } catch (e) { setError(e instanceof Error ? e.message : "Invalid change."); return false; }
  };
  const checkpoint = (running = state.clockRunning) => command({ type: "context.replace", payload: { clockSeconds: secondsRef.current, clockRunning: running } });
  useEffect(() => sync.subscribe(() => render(v => v + 1)), [sync]);
  useEffect(() => {
    try {
      if (state.sessionStarted) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ roster: draftRoster, starters }));
    } catch { setError("Setup draft could not be kept on this device. Save valid setup online before leaving."); }
  }, [draftRoster, starters, state.sessionStarted, draftKey]);
  useEffect(() => {
    // Replayed cloud/outbox running clocks never restart themselves on this device.
    void sync.flush();
    const online = () => { void sync.retry(); };
    const unload = (e: BeforeUnloadEvent) => { if (sync.pending || sync.state.clockRunning || !sync.state.sessionStarted) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("online", online); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("online", online); window.removeEventListener("beforeunload", unload); };
  }, [sync]);
  useEffect(() => {
    if (!clockReady && !sync.blocked) {
      if (!sync.state.clockRunning || command({ type: "context.replace", payload: { clockRunning: false } })) setClockReady(true);
    }
  }, [clockReady, sync.blocked, sync]);
  useEffect(() => {
    if (!clockReady || !state.clockRunning || sync.blocked) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      const next = Math.max(0, secondsRef.current - 1); secondsRef.current = next; setSeconds(next); ticks++;
      if (!next || ticks % 10 === 0) command({ type: "context.replace", payload: { clockSeconds: next, clockRunning: next > 0 } });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [clockReady, state.clockRunning, sync.blocked, sync]);
  const leave = async () => {
    if (!sync.state.sessionStarted && (JSON.stringify(draftRoster) !== JSON.stringify(sync.state.roster) || JSON.stringify(starters) !== JSON.stringify(sync.state.startingLineupsByQuarter[1] ?? []))) {
      setError("Save your roster setup before leaving, or remove incomplete rows."); return;
    }
    if (!sync.blocked && !checkpoint(false)) return;
    if (await sync.flush()) onExit();
    else setError("Not all changes are saved. Retry or export the pending changes before leaving.");
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([sync.exportPending()], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `session-${sync.state.possessions[0].id}-pending.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const addEvent = (possessionId: string, draft: EventDraft) => {
    if (!checkpoint()) return;
    const id = crypto.randomUUID();
    if (!command({ type: "event.add", payload: { possessionId, event: { ...draft, id, playerId: draft.playerId === "__opposition__" ? "" : draft.playerId } } })) return;
    if (!state.clockRunning) setNudge(v => v + 1);
    return id;
  };
  const assist = (possessionId: string, scoreId: string, value: ScoreAssist) => command({ type: "score.assist", payload: { possessionId, scoreId, assist: value, assistEventId: crypto.randomUUID() } });
  const toggle = () => {
    if (!checkpoint()) return;
    return command({ type: "possession.toggle", payload: { clock: currentClock, lineupStintId: sync.state.lineupStints.at(-1)?.id, lineupIds: sync.state.onCourtLineup, endEventId: crypto.randomUUID(), nextPossessionId: `pos-${String(sync.revision + 1).padStart(2, "0")}` } });
  };
  const chooseButtonSide = (side: PossessionSide) => !sync.blocked && (sync.state.currentSide === side || toggle() === true);
  const recordButtonEvent = (side: PossessionSide, draft: EventDraft) => {
    if (!chooseButtonSide(side)) return;
    return addEvent(sync.state.possessions.at(-1)!.id, draft);
  };
  const updateButtonAssist = (scoreId: string, value: ScoreAssist) => {
    const possession = sync.state.possessions.find(p => p.events.some(e => e.id === scoreId));
    if (possession) assist(possession.id, scoreId, value);
    else setError("The selected score is no longer available for an assist.");
  };
  const lineup = (ids: string[], substitutions = state.substitutions, opening = false) => {
    const stints = changeLineup(state.lineupStints, ids, active.quarter, currentClock, crypto.randomUUID());
    return command({ type: "context.replace", payload: { onCourtLineup: ids, lineupStints: stints, substitutions, clockSeconds: secondsRef.current,
      ...(opening ? { startingLineupsByQuarter: { ...state.startingLineupsByQuarter, 1: ids } } : {}) } });
  };
  const draftValid = draftRoster.every(p => p.name.trim() && Number.isInteger(p.number) && p.number >= 0 && p.number <= 999)
    && new Set(draftRoster.map(p => p.number)).size === draftRoster.length;
  const rosterValid = draftRoster.length >= 5 && draftValid && starters.length === 5;
  const fitScreen = state.sessionStarted && pathname === "/tagging";
  return <div className={`app-shell cloud-game-shell${state.sessionStarted ? " game-workspace" : ""}${fitScreen ? " screen-fit tagging-workspace" : state.sessionStarted && pathname === "/substitutions" ? " substitutions-workspace" : ""}`}>
    <header className="active-game-header"><div><small>{competition.name} · Master: {account.name}</small><strong>{game.gameTitle} · {game.teamName} vs {game.opponentName}</strong><small>{game.gameDate} · {game.gameTime} · {game.venue}</small></div><div className="game-header-actions"><button type="button" onClick={() => void leave()}>← Sessions</button><div className={`save-status ${sync.status}`} role="status" aria-live="polite" aria-atomic="true">
      <span>{sync.status === "saved" ? "Saved" : sync.status === "saving" ? `Saving… (${sync.pending} pending)` : sync.status === "offline" ? "Offline — changes kept on this device" : sync.status === "conflict" ? "Conflict — reload required" : "Save needs attention"}</span>
      <span className="last-saved">Last saved <time dateTime={sync.lastSavedAt} title={new Date(sync.lastSavedAt).toLocaleString()}>{new Date(sync.lastSavedAt).toLocaleTimeString()}</time></span>
    </div></div></header>
    {sync.error || error ? <p className="lineup-error" role="alert">{error || sync.error}</p> : null}
    {sync.status === "offline" || sync.status === "conflict" || sync.status === "error" ? <div className="action-row"><button type="button" onClick={() => void sync.retry()}>Retry save</button><button type="button" onClick={download}>Export pending changes</button>{sync.blocked ? <button type="button" onClick={() => {
      if (window.confirm("Discard this device's pending changes and reload the server record? Export them first if needed.")) { try { sync.discardPending(); onReload(); } catch (e) { setError((e as Error).message); } }
    }}>Discard pending and reload</button> : null}</div> : null}
    <fieldset className={`cloud-controls${fitScreen ? " screen-fit-controls" : ""}`} disabled={sync.blocked}>
      {!state.sessionStarted ? <section className="panel setup-panel"><h2>Roster</h2><p className="panel-hint">Edit the player list for this game.</p>
        <div className="roster-editor">
          <div className="roster-header"><span>Starting 5</span><span>#</span><span>Player Name</span><span>Action</span></div>
          {draftRoster.map(p => {
            const invalidNumber = !Number.isInteger(p.number) || p.number < 0 || p.number > 999;
            const duplicateNumber = draftRoster.some(other => other.id !== p.id && other.number === p.number);
            const invalidName = !p.name.trim();
            const invalid = invalidNumber || duplicateNumber || invalidName;
            return <div className="roster-item" key={p.id}>
              <div className={`roster-row${invalid ? " invalid" : ""}`}>
                <label className="roster-starter"><input type="checkbox" aria-label={`Start ${p.name || "player"}`} checked={starters.includes(p.id)} disabled={starters.length === 5 && !starters.includes(p.id)} onChange={e => setStarters(e.target.checked ? [...starters, p.id] : starters.filter(id => id !== p.id))} /><span className="roster-starter-label">Starter</span></label>
                <input type="number" min="0" max="999" aria-label="Jersey number" aria-invalid={invalidNumber || duplicateNumber} value={Number.isFinite(p.number) ? p.number : ""} onChange={e => setDraftRoster(draftRoster.map(player => player.id === p.id ? { ...player, number: e.target.value === "" ? NaN : Number(e.target.value) } : player))} />
                <input aria-label="Player name" aria-invalid={invalidName} value={p.name} onChange={e => setDraftRoster(draftRoster.map(player => player.id === p.id ? { ...player, name: e.target.value } : player))} />
                <button type="button" className="roster-remove-btn" onClick={() => { setDraftRoster(draftRoster.filter(player => player.id !== p.id)); setStarters(starters.filter(id => id !== p.id)); }}>Remove</button>
              </div>
              {invalid ? <p className="roster-error">{invalidNumber ? "Jersey number must be between 0 and 999. " : ""}{invalidName ? "Name is required. " : ""}{duplicateNumber ? "Jersey number must be unique." : ""}</p> : null}
            </div>;
          })}
          <div className="roster-actions"><button type="button" disabled={draftRoster.length >= 100} onClick={() => setDraftRoster([...draftRoster, { id: crypto.randomUUID(), number: NaN, name: "" }])}>Add Player</button></div>
        </div>
        <p role="status">Starting 5 selected: {starters.length} / 5</p>
        <button type="button" className="end-possession-btn" disabled={!rosterValid} onClick={() => {
          const ids = [...starters]; const stints = changeLineup([], ids, 1, currentClock, crypto.randomUUID());
          if (command({ type: "context.replace", payload: { roster: draftRoster, startingLineupsByQuarter: { 1: ids }, onCourtLineup: ids, lineupStints: stints, sessionStarted: true, clockRunning: false } })) navigate("/configuration");
        }}>Start Game Session</button>
        <details className="roster-cloud-options"><summary>Cloud setup options</summary><p>Incomplete rows stay on this device until corrected and saved.</p>
        <div className="action-row"><button type="button" onClick={() => {
          if (!window.confirm("Import the roster stored in this browser into this session's setup? It won't upload until you start the session.")) return;
          try { const rows = JSON.parse(localStorage.getItem("bball-stats.roster.v2") ?? "[]"); if (!Array.isArray(rows)) throw Error("Invalid local roster"); setDraftRoster(rows.slice(0, 100).map(p => ({ id: crypto.randomUUID(), name: String(p.name ?? ""), number: typeof p.number === "number" ? p.number : NaN }))); setStarters([]); } catch (e) { setError((e as Error).message); }
        }}>Import local roster</button><button type="button" disabled={loadingDefaults} onClick={async () => {
          if (draftRoster.length && !window.confirm("Replace this setup draft with your saved account defaults?")) return;
          setLoadingDefaults(true);
          try { const defaults = await api.preferences(); setDraftRoster(defaults.roster.map(p => ({ ...p, id: crypto.randomUUID() }))); setStarters([]); command({ type: "context.replace", payload: { statistics: defaults.statistics } }); } catch (e) { setError((e as Error).message); } finally { setLoadingDefaults(false); }
        }}>Load account defaults</button><button type="button" disabled={!draftValid} onClick={() => { command({ type: "context.replace", payload: { roster: draftRoster, startingLineupsByQuarter: { 1: starters } } }); }}>Save setup</button><button type="button" disabled={!draftValid || loadingDefaults} onClick={async () => {
          if (!window.confirm("Save this roster and these statistic settings as your account defaults for future sessions?")) return;
          setLoadingDefaults(true);
          try { const old = await api.preferences(); await request("me/preferences", "PUT", { roster: draftRoster, statistics: sync.state.statistics }, old.etag ?? undefined, old.etag === null); setError(""); }
          catch (e) { setError((e as Error).message); } finally { setLoadingDefaults(false); }
        }}>Save account defaults</button></div></details>
      </section> : <>
        <section className="global-metrics">{([
          ["Score For", totalPointsFor(state.possessions), state.statistics.offense.shot_made], ["Score Against", totalPointsAgainst(state.possessions), state.statistics.defense.opp_score], ["Turnovers", totalTurnovers(state.possessions), state.statistics.offense.turnover], ["Offensive Rebounds", totalOffensiveRebounds(state.possessions), state.statistics.offense.offensive_rebound], ["Opposition Rebounds", totalOppositionRebounds(state.possessions), state.statistics.defense.opposition_rebound]
        ] as const).map(([label, value, enabled]) => enabled !== false ? <article key={label}><h3>{label}</h3><p>{value}</p></article> : null)}</section>
        <section className="clock-panel" aria-label="Game clock and active possession"><div className="clock-time"><p className="clock-big">{currentClock}</p><span>Time</span></div><div className="active-possession"><strong className="possession-number">{state.possessions.length}</strong><span>Possession</span></div><div className="clock-buttons"><button type="button" className={`clock-toggle-btn ${state.clockRunning ? "is-stop" : "is-start"}${!state.clockRunning && nudge ? ` clock-nudge-${nudge % 2 ? "odd" : "even"}` : ""}`} onClick={() => { setNudge(0); if (state.clockRunning) checkpoint(false); else if (seconds === 600) setChooseSide(true); else checkpoint(true); }}>{state.clockRunning ? "Stop" : "Start"}</button>{[-1, 1].map(delta => <button type="button" key={delta} disabled={state.clockRunning || seconds + delta < 0 || seconds + delta > 3600} onClick={() => { const next = seconds + delta; if (command({ type: "context.replace", payload: { clockSeconds: next } })) { secondsRef.current = next; setSeconds(next); } }}>{delta === 1 ? "+1s" : "-1s"}</button>)}<button type="button" disabled={seconds !== 0} onClick={() => { if (command({ type: "context.replace", payload: { clockSeconds: 600, clockRunning: false } })) { secondsRef.current = 600; setSeconds(600); } }}>Reset 10:00</button></div></section>
        <nav className="candidate-nav"><NavLink to="/tagging">Tagging</NavLink><NavLink to="/substitutions">Substitutions</NavLink><NavLink to="/configuration">Configuration</NavLink><NavLink to="/matrix">Possession Matrix</NavLink><NavLink to="/lineups">Lineup Differential</NavLink><NavLink to="/individual">Individual Point Diff</NavLink></nav>
        <main className="candidate-stage"><Routes>
          <Route path="/tagging" element={<CandidateConsole protectBoundaries players={state.roster} possessions={state.possessions} selectedPossession={active} onSelectPossession={setReviewId} onAddEvent={addEvent} onEndPossession={toggle} onChooseButtonSide={chooseButtonSide} onRecordButtonEvent={recordButtonEvent} onUpdateButtonAssist={updateButtonAssist} currentClock={currentClock} statistics={state.statistics} possessionSide={state.currentSide} onCourtLineup={state.onCourtLineup} onDeleteEvent={(possessionId, eventId) => command({ type: "event.delete", payload: { possessionId, eventId } })} onUpdateScoreAssist={assist} onUpdatePossessionDetails={(possessionId, data) => { command({ type: "possession.details", payload: { possessionId, data } }); }} />} />
          <Route path="/configuration" element={<ConfigurationTab players={state.roster} statistics={state.statistics} startingFive={state.startingLineupsByQuarter[1] ?? []} locked={state.clockRunning || seconds !== 600 || state.substitutions.length > 0 || state.possessions.some(p => p.events.length > 0)} onToggleStatistic={(side, key) => { command({ type: "context.replace", payload: { statistics: { ...state.statistics, [side]: { ...state.statistics[side], [key]: state.statistics[side][key] === false } } } }); }} onSaveStartingFive={ids => { lineup(ids, state.substitutions, true); }} />} />
          <Route path="/substitutions" element={<SubstitutionsTab players={state.roster} onCourtLineup={state.onCourtLineup} substitutions={state.substitutions} currentClock={currentClock} currentQuarter={active.quarter} onRecordSubstitutions={pairs => {
            const ids = state.onCourtLineup.map(id => pairs.find(p => p.playerOutId === id)?.playerInId ?? id);
            const subs = [...state.substitutions, ...pairs.map(p => ({ id: crypto.randomUUID(), quarter: active.quarter, clock: currentClock, ...p }))]; lineup(ids, subs);
          }} />} />
          <Route path="/matrix" element={<CandidateGrid players={state.roster} possessions={state.possessions} selectedPossession={state.possessions.find(p => p.id === reviewId) ?? active} onSelectPossession={setReviewId} onAddEvent={addEvent} onEndPossession={toggle} currentClock={currentClock} />} />
          <Route path="/lineups" element={<LineupDifferential players={state.roster} possessions={state.possessions} lineupStints={state.lineupStints} currentClock={currentClock} />} />
          <Route path="/individual" element={<IndividualDifferential players={state.roster} possessions={state.possessions} lineupStints={state.lineupStints} onCourtLineup={state.onCourtLineup} />} />
          <Route path="*" element={<Navigate to="/configuration" replace />} />
        </Routes></main>
      </>}
    </fieldset>
    <dialog ref={startSideDialog} className="modal-card start-side-dialog" aria-labelledby="start-side-title"
      onCancel={() => setChooseSide(false)} onClose={() => setChooseSide(false)}
      onClick={event => { if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setChooseSide(false);
      } }}>
      <h3 id="start-side-title">Start at 10:00</h3>
      <p className="panel-hint">Choose which side starts this possession.</p>
      <div className="modal-actions start-side-actions">
        {(["offense", "defense"] as const).map(side => <button type="button" key={side} disabled={sync.blocked}
          onClick={() => { if (command({ type: "context.replace", payload: { currentSide: side, clockSeconds: secondsRef.current, clockRunning: true } })) setChooseSide(false); }}>
          {side === "offense" ? "Offense" : "Defense"}
        </button>)}
      </div>
    </dialog>
  </div>;
}