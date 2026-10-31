import { useEffect, useMemo, useState } from "react";
import type { Player, SubstitutionEvent } from "../types";
import { getPlayerName } from "./common";

interface SubstitutionsTabProps {
  players: Player[];
  onCourtLineup: string[];
  substitutions: SubstitutionEvent[];
  currentClock: string;
  currentQuarter: number;
  onRecordSubstitutions: (pairs: Array<{ playerOutId: string; playerInId: string }>) => void;
}

export function SubstitutionsTab({
  players,
  onCourtLineup,
  substitutions,
  currentClock,
  currentQuarter,
  onRecordSubstitutions
}: SubstitutionsTabProps) {
  const bench = useMemo(
    () => players.filter((player) => !onCourtLineup.includes(player.id)),
    [players, onCourtLineup]
  );

  const [selectedOutIds, setSelectedOutIds] = useState<string[]>([]);
  const [selectedInIds, setSelectedInIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedOutIds((current) => current.filter((id) => onCourtLineup.includes(id)));
  }, [onCourtLineup]);

  useEffect(() => {
    setSelectedInIds((current) => current.filter((id) => bench.some((player) => player.id === id)));
  }, [bench]);

  const canRecord = selectedOutIds.length > 0 && selectedOutIds.length === selectedInIds.length;

  const pairedSelections = selectedOutIds.map((outId, index) => ({
    playerOutId: outId,
    playerInId: selectedInIds[index] ?? ""
  }));

  const record = () => {
    if (!canRecord) {
      return;
    }

    onRecordSubstitutions(pairedSelections);
    setSelectedOutIds([]);
    setSelectedInIds([]);
  };

  const toggleOut = (playerId: string) => {
    setSelectedOutIds((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId]
    );
  };

  const toggleIn = (playerId: string) => {
    setSelectedInIds((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId]
    );
  };

  return (
    <section className="substitutions-tab">
      <div className="panel substitutions-panel">
        <h2>Substitutions</h2>
        <p className="panel-hint">Record in/out changes with the live game clock. Timestamp is captured automatically.</p>
        <p className="clock-readout">Timestamp: Q{currentQuarter} {currentClock}</p>

        <div className="sub-grid">
          <div>
            <h3>Player Out</h3>
            <div className="picker-buttons sub-choice-grid">
              {onCourtLineup.map((playerId) => {
                const selectedIndex = selectedOutIds.indexOf(playerId);
                const selected = selectedIndex >= 0;
                return (
                  <button
                    key={playerId}
                    type="button"
                    className={selected ? "event-choice active" : "event-choice"}
                    onClick={() => toggleOut(playerId)}
                  >
                    {getPlayerName(players, playerId)}
                    {selected ? <span className="selection-order">#{selectedIndex + 1}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h3>Player In</h3>
            <div className="picker-buttons sub-choice-grid">
              {bench.map((player) => {
                const selectedIndex = selectedInIds.indexOf(player.id);
                const selected = selectedIndex >= 0;
                return (
                  <button
                    key={player.id}
                    type="button"
                    className={selected ? "event-choice active" : "event-choice"}
                    onClick={() => toggleIn(player.id)}
                  >
                    {player.name}
                    {selected ? <span className="selection-order">#{selectedIndex + 1}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="action-row">
          <button type="button" className="end-possession-btn" onClick={record} disabled={!canRecord}>
            Record Substitution
          </button>
        </div>

        <p className="panel-hint">
          Selected: {selectedOutIds.length} out / {selectedInIds.length} in
          {canRecord ? " (aligned)" : " (select equal counts to record)"}
        </p>

        {pairedSelections.length > 0 ? (
          <ul className="event-list pairing-list">
            {pairedSelections.map((pair, index) => (
              <li key={`pair-${pair.playerOutId}-${pair.playerInId}-${index}`}>
                <span>#{index + 1}</span>
                <span>{getPlayerName(players, pair.playerOutId)} out</span>
                <span>{pair.playerInId ? `${getPlayerName(players, pair.playerInId)} in` : "Select incoming player"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="panel substitutions-side">
        <h2>Current On-Court Group</h2>
        <p className="panel-hint">This five-player group will carry forward into new possessions.</p>
        <div className="picker-buttons">
          {onCourtLineup.map((playerId) => (
            <span key={playerId} className="lineup-chip">
              {getPlayerName(players, playerId)}
            </span>
          ))}
        </div>

        <h3>Substitution Log</h3>
        <ul className="event-list recent-list">
          {substitutions.slice().reverse().map((entry) => (
            <li key={entry.id}>
              <span>Q{entry.quarter} {entry.clock}</span>
              <strong>SUB</strong>
              <span>{getPlayerName(players, entry.playerOutId)} out</span>
              <span>{getPlayerName(players, entry.playerInId)} in</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
