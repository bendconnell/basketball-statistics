export type EventType =
  | "possession_end"
  | "pass"
  | "paint_touch"
  | "assist"
  | "offensive_rebound"
  | "defensive_rebound"
  | "opposition_rebound"
  | "opposition_miss"
  | "steal"
  | "block"
  | "shot_made"
  | "shot_miss"
  | "turnover"
  | "foul"
  | "opp_score";

export interface Player {
  id: string;
  number: number;
  name: string;
}

export type ScoreAssist = { status: "unknown" | "not_applicable" } | { status: "player"; playerId: string };

export interface GameEvent {
  id: string;
  clock: string;
  playerId: string;
  type: EventType;
  points?: number;
  note?: string;
  lineupStintId?: string;
  assist?: ScoreAssist;
  linkedScoreId?: string;
}

export interface Possession {
  id: string;
  quarter: number;
  startClock: string;
  endClock: string;
  lineupIds: string[];
  events: GameEvent[];
  pointsFor: number;
  pointsAgainst: number;
  passCount?: number | null;
  hadPaintTouch?: boolean | null;
  wasFastBreak?: boolean | null;
  side?: PossessionSide;
  completed?: boolean;
  detailsEdited?: boolean;
}

export interface EventDraft {
  playerId: string;
  type: EventType;
  clock: string;
  points?: number;
  note?: string;
}

export interface LineupStint {
  id: string;
  label: string;
  quarter: number;
  startClock: string;
  endClock: string;
  lineupIds: string[];
}

export interface SubstitutionEvent {
  id: string;
  quarter: number;
  clock: string;
  playerOutId: string;
  playerInId: string;
}

export type PossessionSide = "offense" | "defense";
export type StatisticKey = EventType | "fast_break";
export type StatisticsConfiguration = Record<PossessionSide, Partial<Record<StatisticKey, boolean>>>;

export interface PossessionDetailsData {
  passCount?: number | null;
  paintTouch?: boolean | null;
  fastBreak?: boolean | null;
}

export interface PossessionCloseData extends PossessionDetailsData {
  side?: PossessionSide;
}
