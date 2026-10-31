import type { GameEvent, ScoreAssist } from "../types";

export function updateScoreAssist(events: GameEvent[], scoreId: string, assist: ScoreAssist, assistEventId: string): GameEvent[] {
  const score = events.find((event) => event.id === scoreId && event.type === "shot_made");
  if (!score || (assist.status === "player" && assist.playerId === score.playerId)) return events;
  const updated = events.filter((event) => event.linkedScoreId !== scoreId)
    .map((event) => event.id === scoreId ? { ...event, assist } : event);
  if (assist.status === "player") {
    updated.push({
      id: assistEventId, type: "assist", playerId: assist.playerId,
      clock: score.clock, lineupStintId: score.lineupStintId, linkedScoreId: scoreId
    });
  }
  return updated;
}