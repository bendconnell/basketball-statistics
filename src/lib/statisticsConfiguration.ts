import type { PossessionSide, StatisticKey, StatisticsConfiguration } from "../types";

export const STATISTICS_STORAGE_KEY = "bball-stats.statistics.v1";

export const statisticOptions: Record<PossessionSide, { key: StatisticKey; label: string }[]> = {
  offense: [
    { key: "shot_made", label: "Score" },
    { key: "shot_miss", label: "Miss" },
    { key: "offensive_rebound", label: "Offensive rebound" },
    { key: "turnover", label: "Turnover" },
    { key: "pass", label: "Number of passes" },
    { key: "paint_touch", label: "Paint touch" },
    { key: "fast_break", label: "Fast break" }
  ],
  defense: [
    { key: "opp_score", label: "Opposition score" },
    { key: "opposition_miss", label: "Opposition miss" },
    { key: "steal", label: "Steal" },
    { key: "defensive_rebound", label: "Defensive rebound" },
    { key: "opposition_rebound", label: "Opposition rebound" },
    { key: "block", label: "Block" },
    { key: "foul", label: "Foul" },
    { key: "fast_break", label: "Fast break against" }
  ]
};

export function loadStatisticsConfiguration(): StatisticsConfiguration {
  let stored: unknown;
  try { stored = JSON.parse(localStorage.getItem(STATISTICS_STORAGE_KEY) ?? "null"); } catch { stored = null; }
  const result: StatisticsConfiguration = { offense: {}, defense: {} };
  for (const side of ["offense", "defense"] as const) {
    for (const { key } of statisticOptions[side]) {
      const value = (stored as StatisticsConfiguration | null)?.[side]?.[key];
      result[side][key] = typeof value === "boolean" ? value : true;
    }
  }
  return result;
}