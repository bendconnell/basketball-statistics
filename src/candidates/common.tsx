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

export function formatPossessionId(possessionId: string): string {
  const match = possessionId.match(/pos-(\d+)/i);
  if (!match) {
    return possessionId;
  }

  const value = Number(match[1]);
  if (Number.isNaN(value)) {
    return possessionId;
  }

  return String(value).padStart(2, "0");
}
