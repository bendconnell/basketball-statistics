import type { Possession } from "../src/types.js";
import { updateScoreAssist } from "../src/lib/scoreAssist.js";
import { undoEmptyPossessionToggle } from "../src/lib/possessionToggle.js";
import { parseOperation, provenanceSchema, sessionStateSchema, type SessionState, type OperationInput, type OperationContext, type AuthoritativeEvent } from "./session.js";

export class SessionInvariantError extends Error {}

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SessionInvariantError(message);
}
function unique(ids: Array<string | number>, description: string) {
  requireRule(new Set(ids).size === ids.length, `Duplicate ${description}`);
}
export function validateState(input: SessionState): SessionState {
  const state: SessionState = sessionStateSchema.parse(input);
  unique(state.roster.map(p => p.id), "player ID");
  unique(state.roster.map(p => p.number), "jersey number");
  const players = new Set(state.roster.map(p => p.id));
  const checkLineup = (ids: string[]) => { unique(ids, "lineup player"); ids.forEach(id => requireRule(players.has(id), "Unknown lineup player")); };
  checkLineup(state.onCourtLineup);
  Object.values(state.startingLineupsByQuarter).forEach(checkLineup);
  state.lineupStints.forEach(s => checkLineup(s.lineupIds));
  unique(state.lineupStints.map(s => s.id), "stint ID");
  unique(state.substitutions.map(s => s.id), "substitution ID");
  state.substitutions.forEach(s => requireRule(players.has(s.playerInId) && players.has(s.playerOutId) && s.playerInId !== s.playerOutId, "Invalid substitution"));
  unique(state.possessions.map(p => p.id), "possession ID");
  const stints = new Map(state.lineupStints.map(s => [s.id, s]));
  const eventIds: string[] = [];
  state.possessions.forEach((p, index) => {
    checkLineup(p.lineupIds);
    requireRule(index === state.possessions.length - 1 ? !p.completed : p.completed, "Only final possession may be open");
    let pointsFor = 0, pointsAgainst = 0;
    for (const e of p.events) {
      eventIds.push(e.id);
      const scoring = e.type === "shot_made" || e.type === "opp_score";
      requireRule(scoring || e.type === "shot_miss" || e.type === "opposition_miss" || e.points === undefined, "Points on non-shot event");
      if (e.type === "shot_made") pointsFor += e.points ?? 2;
      if (e.type === "opp_score") pointsAgainst += e.points ?? 2;
      const teamEvent = !["possession_end", "opp_score", "opposition_miss", "opposition_rebound"].includes(e.type);
      requireRule(teamEvent ? players.has(e.playerId) : e.playerId === "" || players.has(e.playerId), "Unknown event player");
      if (e.lineupStintId) {
        const stint = stints.get(e.lineupStintId);
        requireRule(stint && stint.quarter === p.quarter, "Unknown/wrong-quarter event stint");
        if (teamEvent) requireRule(stint.lineupIds.includes(e.playerId), "Event player not in attributed lineup");
      }
      requireRule(!e.assist || e.type === "shot_made", "Assist status only belongs to team score");
      if (e.linkedScoreId) {
        const score = p.events.find(s => s.id === e.linkedScoreId);
        requireRule(e.type === "assist" && score?.type === "shot_made" && score.assist?.status === "player" && score.assist.playerId === e.playerId && score.playerId !== e.playerId && score.clock === e.clock && score.lineupStintId === e.lineupStintId, "Invalid assist linkage");
      }
      if (e.assist?.status === "player") {
        const assists = p.events.filter(a => a.linkedScoreId === e.id);
        requireRule(players.has(e.assist.playerId) && e.assist.playerId !== e.playerId && assists.length === 1 && assists[0].playerId === e.assist.playerId, "Missing/duplicate/self assist");
      }
    }
    requireRule(p.pointsFor === pointsFor && p.pointsAgainst === pointsAgainst, "Score totals disagree with events");
    const boundaries = p.events.filter(e => e.type === "possession_end");
    requireRule(p.completed ? boundaries.length === 1 && p.events.at(-1)?.type === "possession_end" : boundaries.length === 0, "Invalid possession boundary");
  });
  unique(eventIds, "event ID");
  requireRule(eventIds.length <= 20000, "Session event limit exceeded");
  // IDs are globally unambiguous across entity kinds too.
  unique([...eventIds, ...state.possessions.map(p => p.id), ...state.roster.map(p => p.id), ...state.lineupStints.map(s => s.id), ...state.substitutions.map(s => s.id)], "entity ID");
  requireRule(!state.clockRunning || (state.sessionStarted && state.onCourtLineup.length === 5 && state.clockSeconds > 0), "Clock needs a started session and five players");
  requireRule(!state.sessionStarted || (state.roster.length >= 5 && state.onCourtLineup.length === 5), "Started session needs five players");
  if (state.sessionStarted) {
    const latest = state.lineupStints.at(-1);
    requireRule(latest && latest.quarter === state.possessions.at(-1)?.quarter && [...latest.lineupIds].sort().join("|") === [...state.onCourtLineup].sort().join("|"), "Current lineup needs matching authoritative stint");
  }
  requireRule(state.possessions.at(-1)?.side === state.currentSide, "Active side mismatch");
  return state;
}
function recalculate(p: Possession) {
  p.pointsFor = p.events.reduce((n, e) => n + (e.type === "shot_made" ? e.points ?? 2 : 0), 0);
  p.pointsAgainst = p.events.reduce((n, e) => n + (e.type === "opp_score" ? e.points ?? 2 : 0), 0);
}
export function applyOperation(input: SessionState, raw: OperationInput, context: OperationContext): SessionState {
  const op = parseOperation(raw);
  const provenance = provenanceSchema.parse(context);
  requireRule(context.revision === op.expectedRevision + 1, "Operation revision mismatch");
  const state = validateState(input); // Parsing clones: never mutate caller state.
  const occupied = new Set([...state.roster.map(p => p.id), ...state.lineupStints.map(s => s.id), ...state.substitutions.map(s => s.id), ...state.possessions.flatMap(p => [p.id, ...p.events.map(e => e.id)])]);
  const fresh = (id: string) => { requireRule(!occupied.has(id), "Duplicate ID"); occupied.add(id); };
  const touch = (e: AuthoritativeEvent) => ({ ...e, updatedProvenance: provenance });
  if (op.type === "context.replace") {
    // No possessions accepted. Keep historical references/provenance intact.
    if (op.payload.lineupStints) {
      for (const old of state.lineupStints) {
        const next = op.payload.lineupStints.find(s => s.id === old.id);
        requireRule(next && next.quarter === old.quarter && next.startClock === old.startClock && JSON.stringify(next.lineupIds) === JSON.stringify(old.lineupIds), "Historical stint attribution cannot be replaced");
      }
    }
    if (op.payload.substitutions) {
      for (const old of state.substitutions) requireRule(op.payload.substitutions.some(s => JSON.stringify(s) === JSON.stringify(old)), "Historical substitutions cannot be replaced");
    }
    Object.assign(state, op.payload);
    const active = state.possessions.at(-1)!;
    active.side = state.currentSide;
    if (!active.events.length) active.lineupIds = [...state.onCourtLineup];
  } else if (op.type === "possession.toggle") {
    requireRule(state.sessionStarted, "Session not started");
    fresh(op.payload.endEventId); fresh(op.payload.nextPossessionId);
    const latestStint = state.lineupStints.at(-1)?.id;
    requireRule(latestStint === op.payload.lineupStintId && [...op.payload.lineupIds].sort().join("|") === [...state.onCourtLineup].sort().join("|"), "Stale toggle context");
    const restored = undoEmptyPossessionToggle(state.possessions, op.payload.clock, latestStint);
    if (restored) {
      state.possessions = restored;
      state.currentSide = restored.at(-1)!.side!;
    } else {
      const active = state.possessions.at(-1)!;
      active.endClock = op.payload.clock; active.completed = true;
      active.events.push({ id: op.payload.endEventId, type: "possession_end", playerId: "", clock: op.payload.clock, lineupStintId: latestStint, provenance } as AuthoritativeEvent);
      state.currentSide = state.currentSide === "offense" ? "defense" : "offense";
      state.possessions.push({ id: op.payload.nextPossessionId, quarter: active.quarter, startClock: op.payload.clock, endClock: op.payload.clock, lineupIds: [...op.payload.lineupIds], events: [], pointsFor: 0, pointsAgainst: 0, side: state.currentSide, completed: false });
    }
  } else {
    const p = state.possessions.find(p => p.id === op.payload.possessionId);
    requireRule(p, "Unknown possession");
    if (op.type === "event.add") {
      requireRule(state.sessionStarted && !p.completed && p === state.possessions.at(-1), "Only active possession accepts new events");
      requireRule(op.payload.event.type !== "possession_end", "Use possession.toggle for boundaries");
      if (!["opp_score", "opposition_miss", "opposition_rebound"].includes(op.payload.event.type)) requireRule(state.onCourtLineup.includes(op.payload.event.playerId), "Event player must be on court");
      fresh(op.payload.event.id);
      p.events.push({ ...op.payload.event, lineupStintId: state.lineupStints.at(-1)?.id, provenance, ...(op.payload.event.type === "shot_made" ? { assist: { status: "unknown" } } : {}) } as AuthoritativeEvent);
    } else if (op.type === "event.delete") {
      const event = p.events.find(e => e.id === op.payload.eventId);
      requireRule(event && event.type !== "possession_end", "Missing event or protected boundary");
      p.events = p.events.filter(e => e.id !== event.id && e.linkedScoreId !== event.id).map(e => e.id === event.linkedScoreId ? touch({ ...e, assist: { status: "unknown" } } as AuthoritativeEvent) : e);
    } else if (op.type === "score.assist") {
      const score = p.events.find(e => e.id === op.payload.scoreId && e.type === "shot_made");
      requireRule(score, "Unknown team score");
      fresh(op.payload.assistEventId);
      if (op.payload.assist.status === "player") {
        const ids = state.lineupStints.find(s => s.id === score.lineupStintId)?.lineupIds ?? p.lineupIds;
        requireRule(ids.includes(op.payload.assist.playerId) && op.payload.assist.playerId !== score.playerId, "Assist must be another player in score lineup");
      }
      p.events = updateScoreAssist(p.events, score.id, op.payload.assist, op.payload.assistEventId).map(e => e.id === op.payload.assistEventId ? { ...e, provenance } as AuthoritativeEvent : e.id === score.id ? touch(e as AuthoritativeEvent) : e);
    } else {
      p.detailsEdited = true;
      const d = op.payload.data;
      if (d.passCount !== undefined) p.passCount = d.passCount;
      if (d.paintTouch !== undefined) p.hadPaintTouch = d.paintTouch;
      if (d.fastBreak !== undefined) p.wasFastBreak = d.fastBreak;
    }
    recalculate(p);
  }
  return validateState(state);
}