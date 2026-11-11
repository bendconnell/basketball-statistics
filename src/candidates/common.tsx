import type { EventDraft, Player, Possession, PossessionCloseData } from "../types";

export interface CandidateProps {
  players: Player[];
  possessions: Possession[];
  selectedPossession: Possession | null;
  onSelectPossession: (possessionId: string) => void;
  onAddEvent: (possessionId: string, draft: EventDraft) => string | void;
  onEndPossession: (data: PossessionCloseData) => void;
  currentClock: string;
  initialPossessionSide?: "offense" | "defense";
}

export function getPlayerName(players: Player[], playerId: string): string {
  if (playerId === "__opposition__") {
    return "Opposition";
  }

  return players.find((player) => player.id === playerId)?.name ?? "Unknown";
}

export function formatPossessionId(possessionId: string, possessions: Pick<Possession, "id">[]): string {
  const index = possessions.findIndex(possession => possession.id === possessionId);
  return index < 0 ? "Unknown" : String(index + 1).padStart(2, "0");
}
