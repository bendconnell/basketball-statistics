import { individualDifferential } from "../lib/metrics";
import type { LineupStint, Player, Possession } from "../types";

interface Props {
  players: Player[];
  possessions: Possession[];
  lineupStints: LineupStint[];
  onCourtLineup: string[];
}

export function IndividualDifferential({ players, possessions, lineupStints, onCourtLineup }: Props) {
  return (
    <section className="lineup-tab">
      <div className="panel">
        <h2>Individual Point Differential</h2>
        {possessions.some((possession) => possession.events.some((event) =>
          (event.type === "shot_made" || event.type === "opp_score") && !event.lineupStintId)) ? (
          <p role="status">Earlier scores without a recorded lineup are excluded from point differential.</p>
        ) : null}
        <div className="differential-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Possessions</th>
                <th>Points For</th>
                <th>Points Against</th>
                <th>Point Diff (+/−)</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const summary = individualDifferential(possessions, lineupStints, player.id);
                const played = lineupStints.some((stint) => stint.lineupIds.includes(player.id));
                return (
                  <tr key={player.id}>
                    <td>#{player.number} {player.name}</td>
                    <td>{onCourtLineup.includes(player.id) ? "On court" : played ? "Bench" : "Not played"}</td>
                    <td>{summary.possessions}</td>
                    <td>{summary.pointsFor}</td>
                    <td>{summary.pointsAgainst}</td>
                    <td>{summary.diff > 0 ? "+" : ""}{summary.diff}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}