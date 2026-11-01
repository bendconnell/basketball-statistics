import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { EventDraft, EventType, PossessionSide, PossessionDetailsData, ScoreAssist, StatisticsConfiguration } from "../types";
import { parseCommand, suggestCommands, spaceAfterCompletedPoints, statisticForCommand, type CommandSuggestion } from "../lib/commands";
import { CandidateProps, formatPossessionId, getPlayerName } from "./common";
import { PossessionDetailsPanel } from "./PossessionDetailsPanel";
import { ButtonTagging } from "./ButtonTagging";
import { useTaggingMode } from "../lib/useTaggingMode";

const OPPOSITION_PLAYER_ID = "__opposition__";

interface ConsoleProps extends CandidateProps {
  statistics: StatisticsConfiguration;
  possessionSide: PossessionSide;
  onCourtLineup: string[];
  onDeleteEvent: (possessionId: string, eventId: string) => boolean | void;
  protectBoundaries?: boolean;
  onUpdatePossessionDetails: (id: string, data: PossessionDetailsData) => void;
  onUpdateScoreAssist: (possessionId: string, scoreId: string, assist: ScoreAssist) => void;
}

export function CandidateConsole({
  players,
  possessions,
  selectedPossession,
  onAddEvent: recordStatEvent,
  onEndPossession,
  currentClock,
  possessionSide,
  onCourtLineup,
  onDeleteEvent,
  protectBoundaries = false,
  statistics,
  onUpdateScoreAssist,
  onUpdatePossessionDetails
}: ConsoleProps) {
  const [taggingMode] = useTaggingMode();
  const [chatInput, setChatInput] = useState("");
  const [sideNudge, setSideNudge] = useState(0);
  const onAddEvent = (possessionId: string, draft: EventDraft) => {
    const id = recordStatEvent(possessionId, draft);
    if (id && draft.type !== "possession_end") setSideNudge((current) => current + 1);
    return id;
  };
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [commandFeedback, setCommandFeedback] = useState("");
  const [detailsRequest, setDetailsRequest] = useState<{ id: string; version: number } | null>(null);
  const recentEvents = possessions.flatMap((possession) =>
    possession.events.map((event) => ({
      ...event,
      possessionId: possession.id,
      detailsEdited: possession.detailsEdited === true,
      quarter: possession.quarter
    }))
  ).reverse();
  const onCourtPlayers = players.filter((player) => onCourtLineup.includes(player.id));
  const suggestions = suggestCommands(chatInput, onCourtPlayers, possessionSide, statistics);
  const availableCommands = suggestCommands("", onCourtPlayers, possessionSide, statistics);
  const suggestionsOpen = showSuggestions && suggestions.length > 0;

  const completeCommand = (suggestion: CommandSuggestion) => {
    setChatInput(`${suggestion.value.trimEnd()} `);
    setActiveSuggestion(-1);
    setShowSuggestions(!suggestion.submit);
    chatInputRef.current?.focus();
  };

  const applyQuickAction = (type: EventType, playerId: string, points?: number) => {
    if (!selectedPossession) {
      return;
    }

    onAddEvent(selectedPossession.id, {
      playerId,
      type,
      points,
      clock: currentClock
    });

  };

  const appendChatMessage = (role: "user" | "system", text: string) => {
    setCommandFeedback(role === "system" ? text : "");
  };

  const findPlayerIdByNumber = (number: number): string | null => {
    const player = players.find((candidate) => candidate.number === number);
    return player?.id ?? null;
  };

  const handleChatCommand = (rawInput: string) => {
    if (!selectedPossession) {
      appendChatMessage("system", "No active possession to tag yet.");
      return;
    }

    const parsed = parseCommand(rawInput, possessionSide);
    if (!parsed) {
      appendChatMessage("system", "Command unclear. Choose a suggestion or type 'help'. Nothing was recorded.");
      return;
    }
    const { canonical: normalized, numbers, command } = parsed;
    if (command.side && command.side !== possessionSide) {
      appendChatMessage("system", `${command.label} is only valid on ${command.side}. Nothing was recorded.`);
      return;
    }

    const statistic = statisticForCommand(command.label);
    if (statistic && statistics[possessionSide][statistic] === false) {
      appendChatMessage("system", `${command.label} is disabled in Configuration. Nothing was recorded.`);
      return;
    }

    if (normalized === "help") {
      appendChatMessage("system", `Available: ${suggestCommands("", onCourtPlayers, possessionSide, statistics).map((suggestion) => suggestion.label).join(" | ")}. Use Configuration to change tracked stats.`);
      return;
    }

    if (normalized.includes("opposition rebound") || normalized.includes("opp rebound")) {
      onAddEvent(selectedPossession.id, {
        playerId: OPPOSITION_PLAYER_ID,
        type: "opposition_rebound",
        clock: currentClock
      });
      appendChatMessage("system", "Opposition rebound recorded.");
      return;
    }

    if (normalized.includes("opposition miss") || normalized.includes("opp miss")) {
      const points = numbers.length ? numbers[0] : 2;
      if (![1, 2, 3].includes(points)) {
        appendChatMessage("system", "Opposition miss value must be 1, 2, or 3.");
        return;
      }

      onAddEvent(selectedPossession.id, {
        playerId: OPPOSITION_PLAYER_ID,
        type: "opposition_miss",
        points,
        clock: currentClock
      });
      appendChatMessage("system", `Opposition miss (${points}) recorded.`);
      return;
    }

    if (command.label === "Opposition Score") {
      const points = numbers[0];
      if (points !== 1 && points !== 2 && points !== 3) {
        appendChatMessage("system", "Opposition score must be 1, 2, or 3. Nothing was recorded.");
        return;
      }

      onAddEvent(selectedPossession.id, {
        playerId: OPPOSITION_PLAYER_ID,
        type: "opp_score",
        points,
        clock: currentClock
      });
      appendChatMessage("system", `Opposition score (${points}) recorded.`);
      return;
    }

    const actionFromText: Array<{ terms: string[]; type: EventType; side: "offense" | "defense" | "either" }> = [
      { terms: ["assist"], type: "assist", side: "offense" },
      { terms: ["offensive rebound", "offense rebound"], type: "offensive_rebound", side: "offense" },
      { terms: ["turnover"], type: "turnover", side: "offense" },
      { terms: ["steal"], type: "steal", side: "defense" },
      { terms: ["defensive rebound", "defense rebound"], type: "defensive_rebound", side: "defense" },
      { terms: ["block"], type: "block", side: "defense" },
      { terms: ["foul"], type: "foul", side: "defense" }
    ];

    const matchedAction = actionFromText.find((candidate) =>
      candidate.terms.some((term) => normalized.includes(term))
    );

    if (normalized.includes("scored") || normalized.includes("score")) {
      if (possessionSide !== "offense") {
        appendChatMessage("system", "Scored can only be tagged while side is Offense.");
        return;
      }

      if (numbers.length !== 2) {
        appendChatMessage("system", "Enter Score <points (1, 2, or 3)> <jersey number>. Example: Score 3 13. Nothing was recorded.");
        return;
      }

      const points = numbers[0];
      const playerNumber = numbers[1];
      if (![1, 2, 3].includes(points)) {
        appendChatMessage("system", "Score value must be 1, 2, or 3.");
        return;
      }

      const playerId = findPlayerIdByNumber(playerNumber);
      if (!playerId) {
        appendChatMessage("system", `No player found with number ${playerNumber}.`);
        return;
      }

      onAddEvent(selectedPossession.id, {
        playerId,
        type: "shot_made",
        points,
        clock: currentClock
      });
      appendChatMessage("system", `Scored ${points} tagged for #${playerNumber}.`);
      return;
    }

    if (normalized.startsWith("miss")) {
      if (possessionSide !== "offense") {
        appendChatMessage("system", "Miss can only be tagged while side is Offense.");
        return;
      }

      if (numbers.length !== 2) {
        appendChatMessage("system", "Enter Miss <points (1, 2, or 3)> <jersey number>. Example: Miss 2 14. Nothing was recorded.");
        return;
      }

      const points = numbers[0];
      const playerNumber = numbers[1];
      if (![1, 2, 3].includes(points)) {
        appendChatMessage("system", "Miss value must be 1, 2, or 3.");
        return;
      }

      const playerId = findPlayerIdByNumber(playerNumber);
      if (!playerId) {
        appendChatMessage("system", `No player found with number ${playerNumber}.`);
        return;
      }

      onAddEvent(selectedPossession.id, {
        playerId,
        type: "shot_miss",
        points,
        clock: currentClock
      });
      appendChatMessage("system", `Miss (${points}) tagged for #${playerNumber}.`);
      return;
    }

    if (!matchedAction) {
      appendChatMessage("system", "I could not parse that command. Type 'help' for examples.");
      return;
    }

    if (matchedAction.side !== "either" && matchedAction.side !== possessionSide) {
      appendChatMessage("system", `That command is only valid on ${matchedAction.side}.`);
      return;
    }

    if (numbers.length === 0) {
      appendChatMessage("system", "Include a player number for that command.");
      return;
    }

    const playerNumber = numbers[0];
    const playerId = findPlayerIdByNumber(playerNumber);
    if (!playerId) {
      appendChatMessage("system", `No player found with number ${playerNumber}.`);
      return;
    }

    applyQuickAction(matchedAction.type, playerId);
    appendChatMessage("system", `${matchedAction.type.replace("_", " ")} tagged for #${playerNumber}.`);
  };

  const submitChatInput = () => {
    const text = chatInput.trim();
    if (!text) {
      return;
    }

    appendChatMessage("user", text);
    setChatInput("");
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    handleChatCommand(text);
    chatInputRef.current?.focus();
  };

  return (
    <section className="candidate candidate-console">
      <div className="panel recent-panel">
        <h2>Possession Entries</h2>
        {recentEvents.length > 0 ? (
          <ul className="event-list recent-list" tabIndex={0} aria-label="Recorded possession stats" aria-live="polite" aria-relevant="additions">
            {recentEvents.map((event) => (
              <li key={event.id}>
                <span>Q{event.quarter} · Poss {formatPossessionId(event.possessionId)}</span>
                <span>{event.clock}</span>
                {event.type === "possession_end" ? (
                  <button
                    type="button"
                    className={`possession-end-entry ${event.detailsEdited ? "is-edited" : "is-unedited"}`}
                    aria-label={`Edit details for possession ${formatPossessionId(event.possessionId)}`}
                    title={event.detailsEdited ? "Details edited" : "Details not edited yet"}
                    aria-controls="possession-details-editor"
                    aria-haspopup="dialog"
                    onClick={() => setDetailsRequest((current) => ({ id: event.possessionId, version: (current?.version ?? 0) + 1 }))}
                  >
                    Possession End <span aria-hidden="true">· Edit</span>
                  </button>
                ) : <strong>{event.type.split("_").join(" ")}</strong>}
                {event.type !== "possession_end" ? <span>{getPlayerName(players, ["opp_score", "opposition_miss", "opposition_rebound"].includes(event.type) ? "__opposition__" : event.playerId)}</span> : null}
                {event.points ? (
                  <em>{event.points} {event.type === "shot_miss" || event.type === "opposition_miss" ? "pt attempt" : "pts"}</em>
                ) : null}
                {event.type === "shot_made" ? <span>Assist: {event.assist?.status === "player"
                  ? getPlayerName(players, event.assist.playerId)
                  : event.assist?.status === "not_applicable" ? "Not Applicable" : "Unknown"}</span> : null}
                {!(protectBoundaries && event.type === "possession_end") ? <button
                  type="button"
                  className="delete-entry-btn"
                  aria-label={`Delete ${event.type.split("_").join(" ")} at ${event.clock} from possession ${formatPossessionId(event.possessionId)}`}
                  title="Delete entry"
                  onClick={() => {
                    if (onDeleteEvent(event.possessionId, event.id) !== false) setCommandFeedback("Entry deleted.");
                    chatInputRef.current?.focus();
                  }}
                >
                  ×
                </button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No stats recorded yet.</p>
        )}
      </div>

      <div className="panel command-panel">
        <div className="tagging-header">
          <h2>Tagging</h2>
          <div className="side-indicator" aria-live="polite">
            <button type="button" className={`side-pill tagging-side-toggle ${possessionSide}${sideNudge ? ` side-nudge-${sideNudge % 2 ? "odd" : "even"}` : ""}`}
              aria-label={`Switch to ${possessionSide === "offense" ? "Defense" : "Offense"} and end current possession`}
              title="Switch side and end current possession"
              onAnimationEnd={() => setSideNudge(0)}
              onClick={() => { setSideNudge(0); onEndPossession({ side: possessionSide }); }}>
              {possessionSide === "offense" ? "Offense" : "Defense"}
            </button>
          </div>
        </div>
        {taggingMode === "buttons" ? (
          <>
            {onCourtPlayers.length !== 5 ? <p className="lineup-error">Select your starting 5 in <Link to="/configuration">Configuration</Link>.</p> : null}
            <ButtonTagging
              key={`${selectedPossession?.id}-${possessionSide}-${onCourtLineup.join(",")}-${JSON.stringify(statistics)}`}
              players={onCourtPlayers}
              side={possessionSide}
              statistics={statistics}
              currentClock={currentClock}
              onRecord={(draft) => { if (selectedPossession) return onAddEvent(selectedPossession.id, draft); }}
              onUpdateAssist={(scoreId, assist) => {
                if (selectedPossession) {
                  onUpdateScoreAssist(selectedPossession.id, scoreId, assist);
                  if (assist.status === "player") setSideNudge((current) => current + 1);
                }
              }}
            />
          </>
        ) : <div className="chat-command-panel">
          {onCourtPlayers.length === 0 ? (
            <p className="lineup-error" role="alert">
              No starting players selected. Jersey suggestions are unavailable. <Link to="/configuration">Select and save your starting 5 in Configuration.</Link>
            </p>
          ) : null}
          <div className="available-commands" aria-label="Available commands">
            {availableCommands.map((command) => (
              <span key={command.value}>{command.label}</span>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              ref={chatInputRef}
              type="text"
              role="combobox"
              aria-label="Stat command"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen}
              aria-controls="command-suggestions"
              aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? `command-suggestion-${activeSuggestion}` : undefined}
              autoComplete="off"
              value={chatInput}
              onChange={(event) => {
                setChatInput(spaceAfterCompletedPoints(event.target.value, chatInput, possessionSide));
                setCommandFeedback("");
                setActiveSuggestion(-1);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  setShowSuggestions(false);
                  setActiveSuggestion(-1);
                } else if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setShowSuggestions(true);
                  setActiveSuggestion((current) => event.key === "ArrowDown"
                    ? (current + 1) % suggestions.length
                    : (current <= 0 ? suggestions.length - 1 : current - 1));
                } else if (event.key === "Tab" && !event.shiftKey && suggestionsOpen) {
                  event.preventDefault();
                  completeCommand(suggestions[activeSuggestion >= 0 ? activeSuggestion : 0]);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (suggestionsOpen && activeSuggestion >= 0) {
                    completeCommand(suggestions[activeSuggestion]);
                  } else {
                    submitChatInput();
                  }
                }
              }}
              placeholder="Enter command"
            />
            <button type="button" onClick={submitChatInput} disabled={!chatInput.trim()}>
              Send
            </button>
          </div>
          {suggestionsOpen ? (
            <div id="command-suggestions" className="command-suggestions" role="listbox" aria-label="Suggested commands">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.value}
                  id={`command-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  className={activeSuggestion === index ? "command-suggestion highlighted" : "command-suggestion"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => completeCommand(suggestion)}
                >
                  <strong>{suggestion.label}</strong>
                  <span>{suggestion.detail}</span>
                </button>
              ))}
            </div>
          ) : null}
          {commandFeedback ? <p className="command-completion-hint" role="status">{commandFeedback}</p> : null}
        </div>}

        <PossessionDetailsPanel possessions={possessions} onUpdate={onUpdatePossessionDetails} editRequest={detailsRequest} statistics={statistics} />
      </div>
    </section>
  );
}
