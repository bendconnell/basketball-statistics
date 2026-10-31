import { stintDifferential } from "../lib/metrics";
import type { LineupStint, Player, Possession } from "../types";
import { getPlayerName } from "./common";

interface LineupDifferentialProps {
  players: Player[];
  possessions: Possession[];
  lineupStints: LineupStint[];
  currentClock: string;
}

export function LineupDifferential({ players, possessions, lineupStints, currentClock }: LineupDifferentialProps) {
  return (
    <section className="lineup-tab">
      <div className="panel">
        <h2>Lineup Point Differential</h2>
        {possessions.some((possession) => possession.events.some((event) =>
          (event.type === "shot_made" || event.type === "opp_score") && !event.lineupStintId)) ? (
          <p role="status">Earlier scores without a recorded lineup are excluded from point differential.</p>
        ) : null}

        <div className="differential-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Stint</th>
              <th>On-Court Group</th>
              <th>Possessions</th>
              <th>Points For</th>
              <th>Points Against</th>
              <th>Differential</th>
            </tr>
          </thead>
          <tbody>
            {lineupStints.map((stint, index) => {
              const summary = stintDifferential(possessions, stint);
              const active = index === lineupStints.length - 1;
              return (
                <tr key={stint.id}>
                  <td>
                    {stint.label} (Q{stint.quarter} {stint.startClock}–{active ? currentClock : stint.endClock}){active ? " · Current" : ""}
                  </td>
                  <td>{stint.lineupIds.map((id) => getPlayerName(players, id)).join(" | ")}</td>
                  <td>{summary.possessions}</td>
                  <td>{summary.pointsFor}</td>
                  <td>{summary.pointsAgainst}</td>
                  <td>
                    {summary.diff > 0 ? "+" : ""}
                    {summary.diff}
                  </td>
                </tr>
              );
            })}
            {lineupStints.length === 0 ? <tr><td colSpan={6}>No lineups recorded. Save your starting five in Configuration.</td></tr> : null}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
