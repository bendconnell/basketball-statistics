import type { GameEvent, ScoreAssist } from "../types";

export function updateScoreAssist(events: GameEvent[], scoreId: string, assist: ScoreAssist, assistEventId: string): GameEvent[] {
  const score = events.find((event) => event.id === scoreId && event.type === "shot_made");
  if (!score || (assist.status === "player" && assist.playerId === score.playerId)) return events;
  const updated = events.filter((event) => event.linkedScoreId !== scoreId)
    .map((event) => event.id === scoreId ? { ...event, assist } : event);
  if (assist.status === "player") {
    const linkedAssist: GameEvent = {
      id: assistEventId, type: "assist", playerId: assist.playerId,
      clock: score.clock, lineupStintId: score.lineupStintId, linkedScoreId: scoreId
    };
    // Historical score edits must keep the possession-end boundary last.
    const boundary = updated.findIndex(event => event.type === "possession_end");
    if (boundary < 0) updated.push(linkedAssist);
    else updated.splice(boundary, 0, linkedAssist);
  }
  return updated;
}