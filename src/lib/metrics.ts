import type { LineupStint, Possession } from "../types";

export interface GroupDiff {
  possessions: number;
  diff: number;
}

export interface StintDiff extends GroupDiff {
  pointsFor: number;
  pointsAgainst: number;
}

export function countPasses(possession: Possession): number | null {
  if (typeof possession.passCount === "number") {
    return possession.passCount;
  }
  if (possession.passCount === null) return null;
  const passes = possession.events.filter((event) => event.type === "pass").length;
  return passes > 0 ? passes : null;
}

export function countPaintTouches(possession: Possession): number | null {
  if (typeof possession.hadPaintTouch === "boolean") {
    return possession.hadPaintTouch ? 1 : 0;
  }
  if (possession.hadPaintTouch === null) return null;
  return possession.events.some((event) => event.type === "paint_touch") ? 1 : null;
}

export function possessionDiff(possession: Possession): number {
  return possession.pointsFor - possession.pointsAgainst;
}

export function totalPasses(possessions: Possession[]): number {
  return possessions.reduce((sum, possession) => sum + (countPasses(possession) ?? 0), 0);
}

export function totalPaintTouches(possessions: Possession[]): number {
  return possessions.reduce((sum, possession) => sum + (countPaintTouches(possession) ?? 0), 0);
}

export function totalTurnovers(possessions: Possession[]): number {
  return possessions.reduce(
    (sum, possession) =>
      sum + possession.events.filter((event) => event.type === "turnover").length,
    0
  );
}

export function totalOffensiveRebounds(possessions: Possession[]): number {
  return possessions.reduce(
    (sum, possession) =>
      sum + possession.events.filter((event) => event.type === "offensive_rebound").length,
    0
  );
}

export function totalOppositionRebounds(possessions: Possession[]): number {
  return possessions.reduce(
    (sum, possession) =>
      sum + possession.events.filter((event) => event.type === "opposition_rebound").length,
    0
  );
}

export function totalOppositionMisses(possessions: Possession[]): number {
  return possessions.reduce(
    (sum, possession) =>
      sum + possession.events.filter((event) => event.type === "opposition_miss").length,
    0
  );
}

export function totalPointsFor(possessions: Possession[]): number {
  return possessions.reduce((sum, possession) => sum + possession.pointsFor, 0);
}

export function totalPointsAgainst(possessions: Possession[]): number {
  return possessions.reduce((sum, possession) => sum + possession.pointsAgainst, 0);
}

export function lineupDifferential(
  possessions: Possession[],
  lineupIds: string[]
): GroupDiff {
  const target = lineupIds.slice().sort().join("|");
  let diff = 0;
  let possessionsCount = 0;

  for (const possession of possessions) {
    const possessionLineup = possession.lineupIds.slice().sort().join("|");
    if (possessionLineup === target) {
      possessionsCount += 1;
      diff += possessionDiff(possession);
    }
  }

  return { possessions: possessionsCount, diff };
}

export function groupDifferential(
  possessions: Possession[],
  groupIds: string[]
): GroupDiff {
  let diff = 0;
  let possessionsCount = 0;

  if (groupIds.length < 2 || groupIds.length > 5) {
    return { possessions: 0, diff: 0 };
  }

  for (const possession of possessions) {
    const containsGroup = groupIds.every((id) => possession.lineupIds.includes(id));
    if (containsGroup) {
      possessionsCount += 1;
      diff += possessionDiff(possession);
    }
  }

  return { possessions: possessionsCount, diff };
}

export function averagePasses(possessions: Possession[]): number | null {
  const known = possessions.filter((possession) => possession.side !== "defense")
    .map(countPasses).filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

export function averagePaintTouches(possessions: Possession[]): number | null {
  const known = possessions.filter((possession) => possession.side !== "defense")
    .map(countPaintTouches).filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

export function stintDifferential(possessions: Possession[], stint: LineupStint): StintDiff {
  let pointsFor = 0;
  let pointsAgainst = 0;
  let possessionsCount = 0;

  for (const possession of possessions) {
    const events = possession.events.filter((event) => event.lineupStintId === stint.id);
    if (events.length) possessionsCount += 1;
    for (const event of events) {
      if (event.type === "shot_made") pointsFor += event.points ?? 2;
      if (event.type === "opp_score") pointsAgainst += event.points ?? 2;
    }
  }

  return {
    possessions: possessionsCount,
    pointsFor,
    pointsAgainst,
    diff: pointsFor - pointsAgainst
  };
}

export function individualDifferential(
  possessions: Possession[], stints: LineupStint[], playerId: string
): StintDiff {
  const stintIds = new Set(stints.filter((stint) => stint.lineupIds.includes(playerId)).map((stint) => stint.id));
  let pointsFor = 0;
  let pointsAgainst = 0;
  let possessionsCount = 0;
  for (const possession of possessions) {
    const events = possession.events.filter((event) => event.lineupStintId && stintIds.has(event.lineupStintId));
    if (events.length) possessionsCount += 1;
    for (const event of events) {
      if (event.type === "shot_made") pointsFor += event.points ?? 2;
      if (event.type === "opp_score") pointsAgainst += event.points ?? 2;
    }
  }
  return { possessions: possessionsCount, pointsFor, pointsAgainst, diff: pointsFor - pointsAgainst };
}
