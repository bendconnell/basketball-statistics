import { z } from "zod";
import type { Player, Possession, LineupStint, SubstitutionEvent, StatisticsConfiguration, GameEvent } from "../src/types.js";

export const MAX_OPERATION_BYTES = 48 * 1024;
export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const clockSchema = z.string().regex(/^(?:[0-5][0-9]:[0-5][0-9]|60:00)$/);
const quarter = z.number().int().min(1).max(20);
const lineup = z.array(idSchema).max(5);
const shortText = z.string().max(200);
export const gameDetailsSchema = z.object({
  gameTitle: shortText, teamName: shortText, opponentName: shortText,
  gameDate: z.string().max(10), venue: shortText, notes: z.string().max(2000)
}).strict();
export const playerSchema = z.object({ id: idSchema, number: z.number().int().min(0).max(999), name: z.string().min(1).max(120).refine(value => value.trim().length > 0, "Player name cannot be blank") }).strict();
export const rosterSchema = z.array(playerSchema).max(100);
export const eventTypes = ["possession_end", "pass", "paint_touch", "assist", "offensive_rebound", "defensive_rebound", "opposition_rebound", "opposition_miss", "steal", "block", "shot_made", "shot_miss", "turnover", "foul", "opp_score"] as const;
export const scoreAssistSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(), z.object({ status: z.literal("not_applicable") }).strict(),
  z.object({ status: z.literal("player"), playerId: idSchema }).strict()
]);
export const eventDraftSchema = z.object({
  id: idSchema, playerId: z.union([idSchema, z.literal("")]), type: z.enum(eventTypes), clock: clockSchema,
  points: z.number().int().min(1).max(3).optional(), note: z.string().max(2000).optional()
}).strict();
export const provenanceSchema = z.object({
  sessionId: idSchema, actorUserId: z.string().min(1).max(256), revision: z.number().int().min(1), timestamp: z.string().datetime()
}).strict();
export type OperationContext = z.infer<typeof provenanceSchema>;
export type AuthoritativeEvent = GameEvent & { provenance: OperationContext; updatedProvenance?: OperationContext };
const eventSchema = eventDraftSchema.extend({
  lineupStintId: idSchema.optional(), assist: scoreAssistSchema.optional(), linkedScoreId: idSchema.optional(),
  provenance: provenanceSchema, updatedProvenance: provenanceSchema.optional()
}).strict();
const details = z.object({ passCount: z.number().int().min(0).max(1000).nullable().optional(), paintTouch: z.boolean().nullable().optional(), fastBreak: z.boolean().nullable().optional() }).strict();
const stintSchema = z.object({ id: idSchema, label: shortText, quarter, startClock: clockSchema, endClock: clockSchema, lineupIds: lineup }).strict();
const substitutionSchema = z.object({ id: idSchema, quarter, clock: clockSchema, playerOutId: idSchema, playerInId: idSchema }).strict();
const statSideSchema = z.object(Object.fromEntries([...eventTypes, "fast_break"].map(key => [key, z.boolean().optional()])) as Record<typeof eventTypes[number] | "fast_break", z.ZodOptional<z.ZodBoolean>>).strict();
export const statisticsSchema = z.object({ offense: statSideSchema, defense: statSideSchema }).strict();
export const contextSchema = z.object({
  sessionStarted: z.boolean(), gameDetails: gameDetailsSchema, roster: rosterSchema,
  onCourtLineup: lineup, lineupStints: z.array(stintSchema).max(2000),
  startingLineupsByQuarter: z.record(z.string().regex(/^(?:[1-9]|1[0-9]|20)$/), lineup),
  substitutions: z.array(substitutionSchema).max(2000), clockSeconds: z.number().int().min(0).max(3600),
  clockRunning: z.boolean(), currentSide: z.enum(["offense", "defense"]), statistics: statisticsSchema
}).strict();
const possessionSchema = z.object({
  id: idSchema, quarter, startClock: clockSchema, endClock: clockSchema, lineupIds: lineup,
  events: z.array(eventSchema).max(5000), pointsFor: z.number().int().min(0).max(15000), pointsAgainst: z.number().int().min(0).max(15000),
  passCount: details.shape.passCount, hadPaintTouch: details.shape.paintTouch, wasFastBreak: details.shape.fastBreak,
  side: z.enum(["offense", "defense"]).optional(), completed: z.boolean().optional(), explicitlyEnded: z.boolean().optional(), detailsEdited: z.boolean().optional()
}).strict();
export const sessionStateSchema = contextSchema.extend({ possessions: z.array(possessionSchema).min(1).max(2000), boundaryUndo: z.object({ left: possessionSchema, right: possessionSchema }).strict().optional(), eventUndo: possessionSchema.optional() }).strict();
export type SessionState = {
  sessionStarted: boolean;
  boundaryUndo?: { left: Possession; right: Possession };
  eventUndo?: Possession;
  gameDetails: z.infer<typeof gameDetailsSchema>;
  roster: Player[]; possessions: Possession[]; onCourtLineup: string[]; lineupStints: LineupStint[];
  startingLineupsByQuarter: Record<number, string[]>; substitutions: SubstitutionEvent[];
  clockSeconds: number; clockRunning: boolean; currentSide: "offense" | "defense"; statistics: StatisticsConfiguration;
};
export const sessionMetadataSchema = z.object({
  id: idSchema, gameId: idSchema, competitionId: idSchema, masterUserId: z.string().min(1).max(256),
  revision: z.number().int().min(0), status: z.enum(["setup", "active", "archived"]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict();
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export type LoadedSession = { session: SessionMetadata; state: SessionState };
// Reserved contract only: no membership/invitation API or contributor writes in v1.
export type SessionMember = { sessionId: string; userId: string; role: "master" | "contributor"; enabled: boolean };
const envelope = { operationId: z.string().uuid(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) };
export const operationInputSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("possession.boundary.delete"), payload: z.object({ possessionId: idSchema, eventId: idSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("possession.boundary.undo"), payload: z.object({ endEventId: idSchema, nextPossessionId: idSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("game.reset"), payload: z.object({ confirmed: z.literal(true), possessionId: idSchema, stintId: idSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("event.add"), payload: z.object({ possessionId: idSchema, event: eventDraftSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("event.delete"), payload: z.object({ possessionId: idSchema, eventId: idSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("event.undo"), payload: z.object({ eventIds: z.array(idSchema).min(1).max(2) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("score.assist"), payload: z.object({ possessionId: idSchema, scoreId: idSchema, assist: scoreAssistSchema, assistEventId: idSchema }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("possession.details"), payload: z.object({ possessionId: idSchema, data: details }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal("context.replace"), payload: contextSchema.partial().strict().refine(v => Object.keys(v).length > 0, "Empty context") }).strict(),
  z.object({ ...envelope, type: z.literal("possession.toggle"), payload: z.object({ clock: clockSchema, lineupStintId: idSchema.optional(), lineupIds: lineup, endEventId: idSchema, nextPossessionId: idSchema, explicitSide: z.enum(["offense", "defense"]).optional() }).strict() }).strict()
]);
export type OperationInput = z.infer<typeof operationInputSchema>;
export function parseOperation(input: unknown): OperationInput {
  const serialized = JSON.stringify(input);
  if (!serialized || serialized.length * 2 >= MAX_OPERATION_BYTES || new TextEncoder().encode(serialized).length >= MAX_OPERATION_BYTES) throw new Error("Operation must be smaller than 48 KiB (UTF-8 and UTF-16)");
  return operationInputSchema.parse(input);
}
export function defaultStatistics(): StatisticsConfiguration {
  return { offense: Object.fromEntries([...eventTypes, "fast_break"].map(k => [k, true])), defense: Object.fromEntries([...eventTypes, "fast_break"].map(k => [k, true])) };
}
export function createInitialState(gameDetails: SessionState["gameDetails"]): SessionState {
  return {
    sessionStarted: false, gameDetails: gameDetailsSchema.parse(gameDetails), roster: [],
    possessions: [{ id: "pos-01", quarter: 1, startClock: "10:00", endClock: "10:00", lineupIds: [], events: [], pointsFor: 0, pointsAgainst: 0, side: "offense", completed: false }],
    onCourtLineup: [], lineupStints: [], startingLineupsByQuarter: {}, substitutions: [], clockSeconds: 600,
    clockRunning: false, currentSide: "offense", statistics: defaultStatistics()
  };
}