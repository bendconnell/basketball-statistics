import type { LineupStint, Player, Possession } from "../types";

export const players: Player[] = [
  { id: "p1", number: 1, name: "Jay Carter" },
  { id: "p2", number: 3, name: "Miles Boone" },
  { id: "p3", number: 8, name: "Tariq Young" },
  { id: "p4", number: 11, name: "Eli Rhodes" },
  { id: "p5", number: 22, name: "Noah Flint" },
  { id: "p6", number: 5, name: "Chris Dalton" },
  { id: "p7", number: 14, name: "Owen Blake" },
  { id: "p8", number: 32, name: "Mason Drew" },
  { id: "p9", number: 9, name: "Rico Hale" },
  { id: "p10", number: 17, name: "Dante Wells" },
  { id: "p11", number: 27, name: "Liam Porter" }
];

export const possessionsSeed: Possession[] = [
  {
    id: "pos-001",
    quarter: 1,
    startClock: "12:00",
    endClock: "11:32",
    lineupIds: ["p1", "p2", "p3", "p4", "p5"],
    pointsFor: 2,
    pointsAgainst: 0,
    events: [
      { id: "e-1", clock: "11:58", playerId: "p1", type: "pass" },
      { id: "e-2", clock: "11:53", playerId: "p2", type: "pass" },
      { id: "e-3", clock: "11:47", playerId: "p4", type: "paint_touch" },
      { id: "e-4", clock: "11:35", playerId: "p5", type: "shot_made", points: 2 }
    ]
  },
  {
    id: "pos-002",
    quarter: 1,
    startClock: "11:12",
    endClock: "10:46",
    lineupIds: ["p1", "p2", "p3", "p4", "p5"],
    pointsFor: 0,
    pointsAgainst: 2,
    events: [
      { id: "e-5", clock: "11:08", playerId: "p3", type: "pass" },
      { id: "e-6", clock: "10:57", playerId: "p2", type: "pass" },
      { id: "e-7", clock: "10:49", playerId: "p1", type: "turnover", note: "bad angle" },
      { id: "e-8", clock: "10:47", playerId: "p1", type: "opp_score", points: 2 }
    ]
  },
  {
    id: "pos-003",
    quarter: 1,
    startClock: "10:29",
    endClock: "09:58",
    lineupIds: ["p1", "p2", "p3", "p4", "p5"],
    pointsFor: 3,
    pointsAgainst: 0,
    events: [
      { id: "e-9", clock: "10:26", playerId: "p2", type: "pass" },
      { id: "e-10", clock: "10:20", playerId: "p3", type: "paint_touch" },
      { id: "e-11", clock: "10:13", playerId: "p4", type: "pass" },
      { id: "e-12", clock: "10:00", playerId: "p1", type: "shot_made", points: 3 }
    ]
  },
  {
    id: "pos-004",
    quarter: 1,
    startClock: "09:38",
    endClock: "09:05",
    lineupIds: ["p1", "p6", "p3", "p4", "p5"],
    pointsFor: 0,
    pointsAgainst: 0,
    events: [
      { id: "e-13", clock: "09:34", playerId: "p6", type: "pass" },
      { id: "e-14", clock: "09:22", playerId: "p3", type: "paint_touch" },
      { id: "e-15", clock: "09:18", playerId: "p4", type: "shot_miss" },
      { id: "e-16", clock: "09:10", playerId: "p5", type: "foul", note: "offensive" }
    ]
  },
  {
    id: "pos-005",
    quarter: 2,
    startClock: "08:51",
    endClock: "08:21",
    lineupIds: ["p1", "p6", "p3", "p7", "p5"],
    pointsFor: 2,
    pointsAgainst: 0,
    events: [
      { id: "e-17", clock: "08:48", playerId: "p7", type: "pass" },
      { id: "e-18", clock: "08:43", playerId: "p1", type: "paint_touch" },
      { id: "e-19", clock: "08:33", playerId: "p6", type: "pass" },
      { id: "e-20", clock: "08:22", playerId: "p5", type: "shot_made", points: 2 }
    ]
  },
  {
    id: "pos-006",
    quarter: 1,
    startClock: "06:55",
    endClock: "06:30",
    lineupIds: ["p6", "p7", "p8", "p9", "p10"],
    pointsFor: 0,
    pointsAgainst: 3,
    events: [
      { id: "e-21", clock: "07:54", playerId: "p8", type: "pass" },
      { id: "e-22", clock: "07:46", playerId: "p6", type: "pass" },
      { id: "e-23", clock: "07:43", playerId: "p9", type: "turnover" },
      { id: "e-24", clock: "07:31", playerId: "p9", type: "opp_score", points: 3 }
    ]
  },
  {
    id: "pos-007",
    quarter: 1,
    startClock: "06:12",
    endClock: "05:45",
    lineupIds: ["p6", "p7", "p8", "p9", "p10"],
    pointsFor: 2,
    pointsAgainst: 0,
    events: [
      { id: "e-25", clock: "07:08", playerId: "p8", type: "pass" },
      { id: "e-26", clock: "07:02", playerId: "p7", type: "paint_touch" },
      { id: "e-27", clock: "06:57", playerId: "p10", type: "pass" },
      { id: "e-28", clock: "06:46", playerId: "p9", type: "shot_made", points: 2 }
    ]
  },
  {
    id: "pos-008",
    quarter: 1,
    startClock: "05:33",
    endClock: "05:02",
    lineupIds: ["p6", "p7", "p8", "p9", "p10"],
    pointsFor: 1,
    pointsAgainst: 0,
    events: [
      { id: "e-29", clock: "05:30", playerId: "p9", type: "pass" },
      { id: "e-30", clock: "05:23", playerId: "p10", type: "paint_touch" },
      { id: "e-31", clock: "05:14", playerId: "p7", type: "foul", note: "shooting" },
      { id: "e-32", clock: "05:03", playerId: "p7", type: "shot_made", points: 1, note: "free throw" }
    ]
  }
];

export const lineupStints: LineupStint[] = [
  {
    id: "stint-1",
    label: "First 5 Minutes",
    quarter: 1,
    startClock: "12:00",
    endClock: "07:00",
    lineupIds: ["p1", "p2", "p3", "p4", "p5"]
  },
  {
    id: "stint-2",
    label: "Next 5 Minutes",
    quarter: 1,
    startClock: "07:00",
    endClock: "02:00",
    lineupIds: ["p6", "p7", "p8", "p9", "p10"]
  }
];
