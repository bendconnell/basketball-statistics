export interface LocalAccount {
  id: string;
  name: string;
  role: "user" | "administrator";
}

export interface ScheduledGame {
  id: string;
  competitionId: string;
  gameTitle: string;
  teamName: string;
  opponentName: string;
  gameDate: string;
  gameTime: string;
  venue: string;
  notes: string;
}

export interface Competition {
  id: string;
  name: string;
  subscriberIds: string[];
}

export interface CompetitionStore {
  competitions: Competition[];
  games: ScheduledGame[];
}

export const COMPETITIONS_STORAGE_KEY = "bball-stats.competitions.v1";

// Demonstration accounts only. Client-side credentials are not secure authentication.
export function loginLocalAccount(username: string, password: string): LocalAccount | null {
  if (username.trim().toLowerCase() === "admin" && password === "admin") {
    return { id: "admin", name: "Administrator", role: "administrator" };
  }
  if (username.trim().toLowerCase() === "user" && password === "user") {
    return { id: "user", name: "User", role: "user" };
  }
  return null;
}

export function loadCompetitions(): CompetitionStore {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COMPETITIONS_STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return { competitions: [], games: [] };
    const value = raw as CompetitionStore;
    const competitions = Array.isArray(value.competitions) ? value.competitions.filter((competition) =>
      competition && typeof competition.id === "string" && typeof competition.name === "string"
      && Array.isArray(competition.subscriberIds) && competition.subscriberIds.every((id) => typeof id === "string")) : [];
    const games = Array.isArray(value.games) ? value.games.filter((game) => game
      && ["id", "competitionId", "gameTitle", "teamName", "opponentName", "gameDate", "gameTime", "venue", "notes"]
        .every((key) => typeof game[key as keyof ScheduledGame] === "string")
      && competitions.some((competition) => competition.id === game.competitionId)) : [];
    return { competitions, games };
  } catch { return { competitions: [], games: [] }; }
}