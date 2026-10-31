import type { LineupStint } from "../types";

export function changeLineup(
  stints: LineupStint[], lineupIds: string[], quarter: number, clock: string, id: string
): LineupStint[] {
  const current = stints[stints.length - 1];
  if (current?.quarter === quarter
    && current.lineupIds.slice().sort().join("|") === lineupIds.slice().sort().join("|")) return stints;

  return [
    ...stints.map((stint, index) => index === stints.length - 1 ? { ...stint, endClock: clock } : stint),
    { id, label: `Lineup ${stints.length + 1}`, quarter, startClock: clock, endClock: clock, lineupIds: [...lineupIds] }
  ];
}