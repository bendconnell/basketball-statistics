import { useState } from "react";
import type { EventDraft, EventType, Player, PossessionSide, ScoreAssist, StatisticsConfiguration } from "../types";

interface Props {
  players: Player[];
  side: PossessionSide;
  statistics: StatisticsConfiguration;
  currentClock: string;
  onRecord: (event: EventDraft) => string | void;
  onUpdateAssist: (scoreId: string, assist: ScoreAssist) => void;
}

type Step =
  | { kind: "home" }
  | { kind: "points"; type: "shot_made" | "opp_score" | "shot_miss" | "opposition_miss" }
  | { kind: "player"; type: EventType; label: string; points?: number }
  | { kind: "assist"; scorerId: string; scoreId: string };

export function ButtonTagging({ players, side, statistics, currentClock, onRecord, onUpdateAssist }: Props) {
  const [step, setStep] = useState<Step>({ kind: "home" });
  const [feedback, setFeedback] = useState("");
  const enabled = (type: EventType) => statistics[side][type] !== false;
  const record = (type: EventType, playerId: string, points?: number, clock = currentClock) => {
    const eventId = onRecord({ type, playerId, points, clock });
    setFeedback(`${type.replaceAll("_", " ")} recorded${playerId === "__opposition__" ? "." : ` for #${players.find((player) => player.id === playerId)?.number}.`}`);
    return eventId;
  };
  const playerAction = (type: EventType, label: string) => {
    setFeedback("");
    setStep({ kind: "player", type, label });
  };
  const playerActions: { type: EventType; label: string }[] = side === "offense"
    ? [{ type: "offensive_rebound", label: "Offensive Rebound" }, { type: "turnover", label: "Turnover" }]
    : [{ type: "steal", label: "Steal" }, { type: "defensive_rebound", label: "Defensive Rebound" }, { type: "block", label: "Block" }, { type: "foul", label: "Foul" }];

  return (
    <div className="button-tagging">
      {step.kind === "home" ? (
        <>
          <div className="tag-action-grid">
            {enabled(side === "offense" ? "shot_made" : "opp_score") ? (
              <button type="button" onClick={() => { setFeedback(""); setStep({ kind: "points", type: side === "offense" ? "shot_made" : "opp_score" }); }}>Score</button>
            ) : null}
            {enabled(side === "offense" ? "shot_miss" : "opposition_miss") ? (
              <button type="button" onClick={() => {
                setFeedback("");
                setStep({ kind: "points", type: side === "offense" ? "shot_miss" : "opposition_miss" });
              }}>Miss</button>
            ) : null}
            {playerActions.filter(({ type }) => enabled(type)).map(({ type, label }) => (
              <button key={type} type="button" onClick={() => playerAction(type, label)}>{label}</button>
            ))}
            {side === "defense" && enabled("opposition_rebound") ? (
              <button type="button" onClick={() => record("opposition_rebound", "__opposition__")}>Opposition Rebound</button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="tag-step-header">
            <strong>{step.kind === "points" ? `${step.type === "shot_miss" || step.type === "opposition_miss" ? "Miss" : "Score"} · Points` : step.kind === "assist" ? "Score · Assist (Unknown)" : `${step.label}${step.points ? ` · ${step.points} points` : ""} · Player`}</strong>
            {step.kind !== "assist" ? <button type="button" className="tag-back" onClick={() => setStep({ kind: "home" })}>Cancel</button> : null}
          </div>
          <div className="tag-action-grid">
            {step.kind === "assist" ? <>
              <button type="button" aria-pressed={true} onClick={() => { onUpdateAssist(step.scoreId, { status: "unknown" }); setStep({ kind: "home" }); }}>Unknown</button>
              <button type="button" onClick={() => { onUpdateAssist(step.scoreId, { status: "not_applicable" }); setStep({ kind: "home" }); }}>Not Applicable</button>
            </> : null}
            {step.kind === "points" ? [1, 2, 3].map((points) => (
              <button type="button" key={points} onClick={() => {
                if (step.type === "opp_score" || step.type === "opposition_miss") {
                  record(step.type, "__opposition__", points);
                  setStep({ kind: "home" });
                } else setStep({ kind: "player", type: step.type, label: step.type === "shot_miss" ? "Miss" : "Score", points });
              }}>{points}</button>
            )) : players.filter((player) => step.kind !== "assist" || player.id !== step.scorerId).map((player) => (
              <button type="button" className="tag-player" key={player.id} onClick={() => {
                if (step.kind === "assist") {
                  onUpdateAssist(step.scoreId, { status: "player", playerId: player.id });
                  setFeedback(`Assist recorded for #${player.number}.`);
                  setStep({ kind: "home" });
                } else if (step.kind === "player") {
                  const scoreId = record(step.type, player.id, step.points);
                  setStep(step.type === "shot_made" && scoreId
                    ? { kind: "assist", scorerId: player.id, scoreId }
                    : { kind: "home" });
                }
              }}>
                <strong>#{player.number}</strong><span>{player.name}</span>
              </button>
            ))}
          </div>
          {step.kind !== "points" && players.length === 0 ? <p>No on-court players available.</p> : null}
        </>
      )}
      {feedback ? <p role="status">{feedback}</p> : null}
    </div>
  );
}