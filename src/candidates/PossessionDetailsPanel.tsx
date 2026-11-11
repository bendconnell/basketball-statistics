import { useEffect, useRef } from "react";
import type { Possession, PossessionDetailsData, StatisticsConfiguration } from "../types";
import { formatPossessionId } from "./common";

interface Props {
  statistics: StatisticsConfiguration;
  possessions: Possession[];
  onUpdate: (id: string, data: PossessionDetailsData) => void;
  editRequest?: { id: string; version: number } | null;
}

export function PossessionDetailsPanel({ possessions, onUpdate, editRequest, statistics }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!editRequest) return;
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, [editRequest]);
  const selected = possessions.find((possession) => possession.id === editRequest?.id);

  if (!selected) return null;
  const enabled = statistics[selected.side ?? "offense"];

  const booleanChoices = [
    { value: null, label: "Unknown" },
    { value: true, label: "Yes" },
    { value: false, label: "No" }
  ];

  return (
    <dialog
      ref={dialogRef}
      id="possession-details-editor"
      className="modal-card possession-details-dialog"
      aria-labelledby="possession-details-title"
      aria-describedby="possession-details-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.close();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          event.currentTarget.close();
        }
      }}
    >
      <h3 id="possession-details-title">Possession {formatPossessionId(selected.id, possessions)} details</h3>
      <p className="panel-hint">Q{selected.quarter} · {selected.startClock} to {selected.endClock} · {selected.side ?? "Side unknown"}</p>
      <div className="possession-details-content">
        <p id="possession-details-description" className="panel-hint">Saved automatically. Leave anything you did not observe as Unknown. This never ends or changes the active possession.</p>

        {selected.side !== "defense" ? <>
            {enabled.pass !== false ? (
            <fieldset>
              <legend>Number of passes</legend>
              <div className="picker-buttons">
                {[
                  { value: null, label: "Unknown" },
                  { value: 0, label: "0 or 1" },
                  { value: 2, label: "2 or 3" },
                  { value: 4, label: "4+" }
                ].map(({ value, label }) => {
                  const active = value === null ? selected.passCount == null
                    : value === 0 ? selected.passCount != null && selected.passCount < 2
                    : value === 2 ? selected.passCount != null && selected.passCount >= 2 && selected.passCount < 4
                    : selected.passCount != null && selected.passCount >= 4;
                  return (
                    <button key={label} type="button" className={`event-choice${active ? " active" : ""}`}
                      aria-pressed={active} onClick={() => onUpdate(selected.id, { passCount: value })}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <small>Pass bands use their lower bound in the average; 4+ counts as 4.</small>
            </fieldset>
            ) : null}
            {enabled.paint_touch !== false ? (
            <fieldset>
              <legend>Paint touch</legend>
              <div className="picker-buttons">
                {booleanChoices.map(({ value, label }) => {
                  const active = (selected.hadPaintTouch ?? null) === value;
                  return (
                    <button key={label} type="button" className={`event-choice${active ? " active" : ""}`}
                      aria-pressed={active} onClick={() => onUpdate(selected.id, { paintTouch: value })}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            ) : null}
          </> : null}

        {enabled.fast_break !== false ? <fieldset>
          <legend>{selected.side === "defense" ? "Fast break against" : "Fast break"}</legend>
          <div className="picker-buttons">
            {booleanChoices.map(({ value, label }) => {
              const active = (selected.wasFastBreak ?? null) === value;
              return (
                <button key={label} type="button" className={`event-choice${active ? " active" : ""}`}
                  aria-pressed={active} onClick={() => onUpdate(selected.id, { fastBreak: value })}>
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset> : null}
        {enabled.fast_break === false && (selected.side === "defense" || (enabled.pass === false && enabled.paint_touch === false)) ? (
          <p>No possession-detail stats enabled for this side.</p>
        ) : null}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={() => dialogRef.current?.close()}>Later</button>
        <button type="button" onClick={() => dialogRef.current?.close()}>Done</button>
      </div>
    </dialog>
  );
}