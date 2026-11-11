import type { Possession } from "../types";

export function undoEmptyPossessionToggle(
  possessions: Possession[], currentClock: string, currentLineupStintId?: string
): Possession[] | null {
  if (possessions.length < 2) return null;
  const active = possessions[possessions.length - 1];
  const previous = possessions[possessions.length - 2];
  const boundary = previous.events[previous.events.length - 1];
  if (active.completed || active.events.length || active.pointsFor || active.pointsAgainst
    || active.passCount != null || active.hadPaintTouch != null || active.wasFastBreak != null
    || !previous.completed || previous.explicitlyEnded || boundary?.type !== "possession_end"
    || previous.quarter !== active.quarter || previous.side === active.side
    || boundary.lineupStintId !== currentLineupStintId) return null;

  return [
    ...possessions.slice(0, -2),
    { ...previous, completed: false, endClock: currentClock, events: previous.events.slice(0, -1) }
  ];
}