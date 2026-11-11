import { useState } from "react";
import { Link } from "react-router-dom";
import type { Player, PossessionSide, StatisticKey, StatisticsConfiguration } from "../types";
import { statisticOptions } from "../lib/statisticsConfiguration";

interface Props {
  players: Player[];
  startingFive: string[];
  locked: boolean;
  onSaveStartingFive: (lineupIds: string[]) => void;
  statistics: StatisticsConfiguration;
  onToggleStatistic: (side: PossessionSide, key: StatisticKey) => void;
}

export function ConfigurationTab({ players, startingFive, locked, onSaveStartingFive, statistics, onToggleStatistic }: Props) {
  const [draft, setDraft] = useState(startingFive);
  const [saved, setSaved] = useState(false);
  const valid = draft.length === 5 && draft.every((id) => players.some((player) => player.id === id));

  return (
    <section className="panel">
      <h2>Configuration</h2>
      <h3>Tracked statistics</h3>
      <p>Stat selections save automatically. Disabled stats are hidden from capture; previously recorded data is kept.</p>
      <div className="statistics-configuration">
        {(["offense", "defense"] as const).map((side) => (
          <fieldset key={side}>
            <legend>{side === "offense" ? "Offense" : "Defense"}</legend>
            {statisticOptions[side].map(({ key, label }) => (
              <label key={key} className="statistic-option">
                <input type="checkbox" checked={statistics[side][key] !== false}
                  onChange={() => onToggleStatistic(side, key)} />
                {label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <h3>Starting 5</h3>
      {locked ? <p>The opening lineup is set. Use <Link to="/substitutions">Substitutions</Link> for subsequent changes, including later quarters.</p> : null}
      <div className="picker-buttons sub-choice-grid all-player-grid">
        {players.map((player) => {
          const selected = draft.includes(player.id);
          return (
            <button key={player.id} type="button" className={`event-choice${selected ? " active" : ""}`}
              aria-pressed={selected} disabled={locked || (!selected && draft.length >= 5)}
              onClick={() => {
                setSaved(false);
                setDraft((current) => selected ? current.filter((id) => id !== player.id) : [...current, player.id]);
              }}>
              #{player.number} {player.name}
            </button>
          );
        })}
      </div>
      <p>Selected: {draft.length} / 5</p>
      <button type="button" className="end-possession-btn" disabled={locked || !valid}
        onClick={() => { onSaveStartingFive(draft); setSaved(true); }}>
        Save Starting 5
      </button>
      {saved ? <p role="status">Starting 5 saved.</p> : null}
    </section>
  );
}