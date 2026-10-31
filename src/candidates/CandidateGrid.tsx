import { countPaintTouches, countPasses, possessionDiff } from "../lib/metrics";
import { CandidateProps, formatPossessionId, getPlayerName } from "./common";

export function CandidateGrid({
  players,
  possessions,
  selectedPossession,
  onSelectPossession
}: CandidateProps) {
  return (
    <section className="candidate candidate-grid">
      <div className="panel table-panel">
        <h2>Possession Matrix</h2>
        <p className="panel-hint">Click any row to inspect details. Unanswered details remain Unknown.</p>
        <table>
          <thead>
            <tr>
              <th>Possession</th>
              <th>QTR</th>
              <th>Passes</th>
              <th>Paint Touches</th>
              <th>Fast Break</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {possessions.map((possession) => {
              const selected = selectedPossession?.id === possession.id;
              return (
                <tr
                  key={possession.id}
                  className={selected ? "selected" : ""}
                  onClick={() => onSelectPossession(possession.id)}
                >
                  <td>{formatPossessionId(possession.id)}</td>
                  <td>{possession.quarter}</td>
                  <td>{possession.side === "defense" ? "—" : countPasses(possession) === null ? "Unknown" : possession.passCount != null ? possession.passCount < 2 ? "0 or 1" : possession.passCount < 4 ? "2 or 3" : "4+" : countPasses(possession)}</td>
                  <td>{possession.side === "defense" ? "—" : countPaintTouches(possession) === null ? "Unknown" : countPaintTouches(possession) ? "Yes" : "No"}</td>
                  <td>{possession.wasFastBreak == null ? "Unknown" : possession.wasFastBreak ? "Yes" : "No"}</td>
                  <td>
                    {possessionDiff(possession) > 0 ? "+" : ""}
                    {possessionDiff(possession)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel detail-panel">
        {selectedPossession ? (
          <>
            <h2>
              {formatPossessionId(selectedPossession.id)} | Q{selectedPossession.quarter} {selectedPossession.startClock} to {selectedPossession.endClock}
            </h2>
            <p className="panel-hint">Review possession details in this tab. Use the Tagging tab to register events.</p>
            <p>
              Lineup: {selectedPossession.lineupIds.map((id) => getPlayerName(players, id)).join(" | ")}
            </p>
            <ul className="event-list">
              {selectedPossession.events.map((event) => (
                <li key={event.id}>
                  <span>{event.clock}</span>
                  <strong>{event.type === "possession_end" ? "Possession End" : event.type}</strong>
                  {event.type !== "possession_end" ? <span>{getPlayerName(players, ["opp_score", "opposition_miss", "opposition_rebound"].includes(event.type) ? "__opposition__" : event.playerId)}</span> : null}
                  {event.points ? <em>{event.points} pts</em> : null}
                  {event.note ? <small>{event.note}</small> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Select a possession to inspect details.</p>
        )}
      </div>
    </section>
  );
}
