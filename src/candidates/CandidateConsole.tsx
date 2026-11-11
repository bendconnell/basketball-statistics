import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventDraft, PossessionSide, PossessionDetailsData, ScoreAssist, StatisticsConfiguration } from "../types";
import { CandidateProps, formatPossessionId, getPlayerName } from "./common";
import { PossessionDetailsPanel } from "./PossessionDetailsPanel";
import { ButtonTagging } from "./ButtonTagging";

interface ConsoleProps extends CandidateProps {
  statistics: StatisticsConfiguration;
  possessionSide: PossessionSide;
  onCourtLineup: string[];
  onChooseButtonSide: (side: PossessionSide) => boolean;
  onRecordButtonEvent: (side: PossessionSide, draft: EventDraft) => string | void;
  onUpdateButtonAssist: (scoreId: string, assist: ScoreAssist) => void;
  onExplicitEnd: (side: PossessionSide) => string | void;
  onDeleteEvent: (possessionId: string, eventId: string) => boolean | void;
  canUndoBoundary: boolean;
  onUndoBoundary: () => boolean;
  onUpdatePossessionDetails: (id: string, data: PossessionDetailsData) => void;
  onUpdateScoreAssist: (possessionId: string, scoreId: string, assist: ScoreAssist) => void;
}

export function CandidateConsole({ players, possessions, currentClock, possessionSide, onCourtLineup,
  onChooseButtonSide, onRecordButtonEvent, onUpdateButtonAssist, onExplicitEnd, onDeleteEvent,
  canUndoBoundary, onUndoBoundary, statistics, onUpdatePossessionDetails }: ConsoleProps) {
  const [feedback, setFeedback] = useState("");
  const [detailsRequest, setDetailsRequest] = useState<{ id: string; version: number } | null>(null);
  const recentEvents = possessions.flatMap(possession => possession.events.map(event => ({
    ...event, possessionId: possession.id, detailsEdited: possession.detailsEdited === true, quarter: possession.quarter
  }))).reverse();
  const onCourtPlayers = players.filter(player => onCourtLineup.includes(player.id));

  return (
    <section className="candidate candidate-console">
      <div className="panel recent-panel">
        <div className="possession-entries-header">
          <h2>Possession Entries</h2>
          {canUndoBoundary ? <button type="button" title="Restore the latest deleted entry. Available until the next stat or gameplay edit."
            onClick={() => { if (onUndoBoundary()) setFeedback("Deleted entry restored."); }}>Undo deletion</button> : null}
        </div>
        {recentEvents.length > 0 ? (
          <ul className="event-list recent-list" tabIndex={0} aria-label="Recorded possession stats" aria-live="polite" aria-relevant="additions">
            {recentEvents.map(event => (
              <li key={event.id}>
                <span>Q{event.quarter} · Poss {formatPossessionId(event.possessionId, possessions)}</span>
                <span>{event.clock}</span>
                {event.type === "possession_end" ? (
                  <button type="button" className={`possession-end-entry ${event.detailsEdited ? "is-edited" : "is-unedited"}`}
                    aria-label={`Edit details for possession ${formatPossessionId(event.possessionId, possessions)}`}
                    title={event.detailsEdited ? "Details edited" : "Details not edited yet"}
                    aria-controls="possession-details-editor" aria-haspopup="dialog"
                    onClick={() => setDetailsRequest(current => ({ id: event.possessionId, version: (current?.version ?? 0) + 1 }))}>
                    Possession End <span aria-hidden="true">· Edit</span>
                  </button>
                ) : <strong>{event.type.split("_").join(" ")}</strong>}
                {event.type !== "possession_end" ? <span>{getPlayerName(players, ["opp_score", "opposition_miss", "opposition_rebound"].includes(event.type) ? "__opposition__" : event.playerId)}</span> : null}
                {event.points ? <em>{event.points} {event.type === "shot_miss" || event.type === "opposition_miss" ? "pt attempt" : "pts"}</em> : null}
                {event.type === "shot_made" ? <span>Assist: {event.assist?.status === "player" ? getPlayerName(players, event.assist.playerId) : event.assist?.status === "not_applicable" ? "Not Applicable" : "Unknown"}</span> : null}
                <button type="button" className="delete-entry-btn"
                  aria-label={`Delete ${event.type.split("_").join(" ")} at ${event.clock} from possession ${formatPossessionId(event.possessionId, possessions)}`}
                  title="Delete entry" onClick={() => { if (onDeleteEvent(event.possessionId, event.id) !== false) setFeedback("Entry deleted."); }}>×</button>
              </li>
            ))}
          </ul>
        ) : <p>No stats recorded yet.</p>}
        {feedback ? <p role="status">{feedback}</p> : null}
      </div>
      <div className="panel command-panel">
        <div className="tagging-header">
          <h2>Tagging</h2>
          <span className="side-indicator" aria-live="polite">Current possession: {possessionSide === "offense" ? "Offense" : "Defense"}</span>
        </div>
        {onCourtPlayers.length !== 5 ? <p className="lineup-error">Select your starting 5 in <Link to="/configuration">Configuration</Link>.</p> : null}
        <div className="tagging-side-sections">
          {(["offense", "defense"] as const).map(side => (
            <section key={side} className={`tagging-side-section ${side}`} aria-label={`${side === "offense" ? "Offense" : "Defense"} tagging`}>
              <div className="tagging-section-header">
              <h3>{side === "offense" ? "Offense" : "Defense"}</h3>
              <button type="button" className="end-possession-btn" disabled={onCourtPlayers.length !== 5 || side !== possessionSide} onClick={() => {
                const id = onExplicitEnd(side);
                if (id) setDetailsRequest(current => ({ id, version: (current?.version ?? 0) + 1 }));
              }}>End Possession</button>
              </div>
              <ButtonTagging key={`${onCourtLineup.join(",")}-${JSON.stringify(statistics)}`}
                players={onCourtPlayers} side={side} statistics={statistics} currentClock={currentClock}
                onChooseSide={() => onChooseButtonSide(side)} onRecord={draft => onRecordButtonEvent(side, draft)}
                onUpdateAssist={onUpdateButtonAssist} />
            </section>
          ))}
        </div>
        <PossessionDetailsPanel possessions={possessions} onUpdate={onUpdatePossessionDetails} editRequest={detailsRequest} statistics={statistics} />
      </div>
    </section>
  );
}
