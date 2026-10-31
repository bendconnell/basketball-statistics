import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { players as seedPlayers } from "./data/seed";
import {
  totalOffensiveRebounds,
  totalOppositionRebounds,
  totalPointsAgainst,
  totalPointsFor,
  totalTurnovers
} from "./lib/metrics";
import type { EventDraft, LineupStint, Player, Possession, PossessionCloseData, PossessionDetailsData, ScoreAssist, SubstitutionEvent } from "./types";
import { updateScoreAssist } from "./lib/scoreAssist";
import { undoEmptyPossessionToggle } from "./lib/possessionToggle";
import { changeLineup } from "./lib/lineups";
import { loadStatisticsConfiguration, STATISTICS_STORAGE_KEY } from "./lib/statisticsConfiguration";
import { CandidateGrid } from "./candidates/CandidateGrid";
import { CandidateConsole } from "./candidates/CandidateConsole";
import { formatPossessionId } from "./candidates/common";
import { LineupDifferential } from "./candidates/LineupDifferential";
import { IndividualDifferential } from "./candidates/IndividualDifferential";
import { SubstitutionsTab } from "./candidates/SubstitutionsTab";
import { ConfigurationTab } from "./candidates/ConfigurationTab";
import { CompetitionPortal, LoginScreen } from "./CompetitionPortal";
import type { Competition, LocalAccount, ScheduledGame } from "./lib/competitions";

const ROSTER_STORAGE_KEY = "bball-stats.roster.v2";
const LEGACY_ROSTER_STORAGE_KEY = "bball-stats.roster.v1";

function makeEventId(): string {
  return `e-${Math.random().toString(16).slice(2, 10)}`;
}

function makePlayerId(): string {
  return `p-${Math.random().toString(16).slice(2, 10)}`;
}

function loadStoredRoster(): Player[] {
  if (typeof window === "undefined") {
    return seedPlayers.map((player) => ({ ...player }));
  }

  try {
    const v2Raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_ROSTER_STORAGE_KEY);
    const raw = v2Raw ?? legacyRaw;
    const isLegacy = !v2Raw && Boolean(legacyRaw);

    if (!raw) {
      return seedPlayers.map((player) => ({ ...player }));
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return seedPlayers.map((player) => ({ ...player }));
    }

    const normalized = parsed
      .map((item) => {
        const id = typeof item?.id === "string" && item.id ? item.id : makePlayerId();
        const rawNumber = item?.number;
        let number = Number.NaN;
        if (typeof rawNumber === "number" && Number.isFinite(rawNumber)) {
          number = rawNumber;
        } else if (typeof rawNumber === "string" && rawNumber.trim()) {
          const parsedNumber = Number(rawNumber);
          number = Number.isFinite(parsedNumber) ? parsedNumber : Number.NaN;
        }

        // Legacy migration: older builds converted blank values to 0 on reload.
        if (isLegacy && number === 0) {
          number = Number.NaN;
        }

        const name = typeof item?.name === "string" ? item.name : "";
        return {
          id,
          number,
          name
        } as Player;
      })
      .filter((player) => player.id);

    return normalized.length ? normalized : seedPlayers.map((player) => ({ ...player }));
  } catch {
    return seedPlayers.map((player) => ({ ...player }));
  }
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function nextPossessionId(possessions: Possession[]): string {
  let max = 0;
  for (const possession of possessions) {
    const match = possession.id.match(/pos-(\d+)/i);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (!Number.isNaN(value) && value > max) {
      max = value;
    }
  }

  return `pos-${String(max + 1).padStart(2, "0")}`;
}

function createInitialPossession(): Possession {
  return {
    id: "pos-01",
    quarter: 1,
    startClock: "10:00",
    endClock: "10:00",
    lineupIds: [],
    events: [],
    pointsFor: 0,
    pointsAgainst: 0,
    side: "offense",
    completed: false
  };
}

export default function App() {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [selectedGame, setSelectedGame] = useState<{ game: ScheduledGame; competition: Competition } | null>(null);
  if (!account) return <LoginScreen onLogin={setAccount} />;
  if (!selectedGame) return <CompetitionPortal account={account} onLogout={() => setAccount(null)} onSelectGame={(game, competition) => {
    if (account.role === "administrator" || competition.subscriberIds.includes(account.id)) setSelectedGame({ game, competition });
  }} />;
  return <GameTracker key={selectedGame.game.id} game={selectedGame.game} competition={selectedGame.competition}
    onExit={() => setSelectedGame(null)} />;
}

function GameTracker({ game, competition, onExit }: { game: ScheduledGame; competition: Competition; onExit: () => void }) {
  const navigate = useNavigate();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [statistics, setStatistics] = useState(loadStatisticsConfiguration);
  useEffect(() => {
    try { localStorage.setItem(STATISTICS_STORAGE_KEY, JSON.stringify(statistics)); } catch { /* Storage may be unavailable. */ }
  }, [statistics]);
  const [gameDetails, setGameDetails] = useState({
    gameTitle: game.gameTitle,
    teamName: game.teamName,
    opponentName: game.opponentName,
    gameDate: game.gameDate,
    venue: game.venue,
    notes: game.notes
  });
  const [possessions, setPossessions] = useState<Possession[]>([createInitialPossession()]);
  const [selectedPossessionId, setSelectedPossessionId] = useState<string>("pos-01");
  const [onCourtLineup, setOnCourtLineup] = useState<string[]>([]);
  const [lineupStints, setLineupStints] = useState<LineupStint[]>([]);
  const [startingLineupsByQuarter, setStartingLineupsByQuarter] = useState<Record<number, string[]>>({});
  const [substitutions, setSubstitutions] = useState<SubstitutionEvent[]>([]);
  const [clockSeconds, setClockSeconds] = useState<number>(10 * 60);
  const [clockRunning, setClockRunning] = useState<boolean>(false);
  const [clockNudge, setClockNudge] = useState(0);
  const [showStartSideModal, setShowStartSideModal] = useState<boolean>(false);
  const [initialPossessionSide, setInitialPossessionSide] = useState<"offense" | "defense">("offense");
  const [roster, setRoster] = useState<Player[]>(loadStoredRoster);
  const [pendingFocusPlayerId, setPendingFocusPlayerId] = useState<string | null>(null);
  const rosterNumberInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const rosterValidation = useMemo(() => {
    const blankNameIds = new Set<string>();
    const missingNumberIds = new Set<string>();
    const duplicateNumberIds = new Set<string>();
    const numberMap = new Map<number, string[]>();

    for (const player of roster) {
      if (!player.name.trim()) {
        blankNameIds.add(player.id);
      }

      if (!Number.isFinite(player.number)) {
        missingNumberIds.add(player.id);
        continue;
      }

      const numberEntries = numberMap.get(player.number) ?? [];
      numberEntries.push(player.id);
      numberMap.set(player.number, numberEntries);
    }

    for (const ids of numberMap.values()) {
      if (ids.length > 1) {
        ids.forEach((id) => duplicateNumberIds.add(id));
      }
    }

    return {
      blankNameIds,
      missingNumberIds,
      duplicateNumberIds,
      hasErrors: blankNameIds.size > 0 || missingNumberIds.size > 0 || duplicateNumberIds.size > 0
    };
  }, [roster]);

  useEffect(() => {
    if (!clockRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setClockSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setClockRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [clockRunning]);

  useEffect(() => {
    const rosterToStore = roster.map((player) => ({
      ...player,
      number: Number.isFinite(player.number) ? player.number : null
    }));
    window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(rosterToStore));
  }, [roster]);

  useEffect(() => {
    if (!pendingFocusPlayerId) {
      return;
    }

    const input = rosterNumberInputRefs.current[pendingFocusPlayerId];
    if (!input) {
      return;
    }

    input.focus();
    input.select();
    setPendingFocusPlayerId(null);
  }, [roster, pendingFocusPlayerId]);

  const selectedPossession = useMemo(
    () => possessions.find((possession) => possession.id === selectedPossessionId) ?? null,
    [possessions, selectedPossessionId]
  );

  const currentClock = useMemo(() => formatClock(clockSeconds), [clockSeconds]);

  const sharedStats = useMemo(() => {
    return {
      pointsFor: totalPointsFor(possessions),
      pointsAgainst: totalPointsAgainst(possessions),
      turnovers: totalTurnovers(possessions),
      offensiveRebounds: totalOffensiveRebounds(possessions),
      oppositionRebounds: totalOppositionRebounds(possessions)
    };
  }, [possessions]);

  const addEvent = (possessionId: string, draft: EventDraft) => {
    if (!possessions.some((possession) => possession.id === possessionId)) return;
    if (!clockRunning && draft.type !== "possession_end") {
      setClockNudge((current) => current + 1);
    }
    const event = { ...draft, id: makeEventId(), lineupStintId: lineupStints[lineupStints.length - 1]?.id,
      ...(draft.type === "shot_made" ? { assist: { status: "unknown" as const } } : {}) };
    setPossessions((current) =>
      current.map((possession) => {
        if (possession.id !== possessionId) {
          return possession;
        }

        let pointsFor = possession.pointsFor;
        let pointsAgainst = possession.pointsAgainst;

        if (draft.type === "shot_made") {
          pointsFor += draft.points ?? 2;
        }

        if (draft.type === "opp_score") {
          pointsAgainst += draft.points ?? 2;
        }

        return {
          ...possession,
          pointsFor,
          pointsAgainst,
          events: [...possession.events, event]
        };
      })
    );
    return event.id;
  };

  const setScoreAssist = (possessionId: string, scoreId: string, assist: ScoreAssist) => {
    if (assist.status === "player" && !onCourtLineup.includes(assist.playerId)) return;
    const assistEventId = makeEventId();
    setPossessions((current) => current.map((possession) => possession.id === possessionId
      ? { ...possession, events: updateScoreAssist(possession.events, scoreId, assist, assistEventId) }
      : possession));
  };

  const deleteEvent = (possessionId: string, eventId: string) => {
    setPossessions((current) => current.map((possession) => {
      if (possession.id !== possessionId) return possession;
      const event = possession.events.find((entry) => entry.id === eventId);
      if (!event) return possession;
      return {
        ...possession,
        events: possession.events.filter((entry) => entry.id !== eventId && entry.linkedScoreId !== eventId)
          .map((entry) => entry.id === event.linkedScoreId ? { ...entry, assist: { status: "unknown" as const } } : entry),
        pointsFor: possession.pointsFor - (event.type === "shot_made" ? event.points ?? 2 : 0),
        pointsAgainst: possession.pointsAgainst - (event.type === "opp_score" ? event.points ?? 2 : 0)
      };
    }));
  };

  const shiftClock = (deltaSeconds: number) => {
    setClockSeconds((current) => Math.max(0, current + deltaSeconds));
  };

  const endPossession = (data: PossessionCloseData) => {
    const active = possessions[possessions.length - 1];
    if (!active) return;
    const restored = undoEmptyPossessionToggle(possessions, currentClock, lineupStints[lineupStints.length - 1]?.id);
    if (restored) {
      const reopened = restored[restored.length - 1];
      setPossessions(restored);
      setSelectedPossessionId(reopened.id);
      setInitialPossessionSide(reopened.side ?? (initialPossessionSide === "offense" ? "defense" : "offense"));
      return;
    }
    const createdId = nextPossessionId(possessions);
    const side = data.side ?? initialPossessionSide;
    const nextSide = side === "offense" ? "defense" : "offense";
    const endEvent = {
      id: makeEventId(),
      type: "possession_end" as const,
      playerId: "",
      clock: currentClock,
      lineupStintId: lineupStints[lineupStints.length - 1]?.id
    };
    setPossessions((current) => [
      ...current.map((possession) => possession.id === active.id
        ? { ...possession, endClock: currentClock, side, completed: true, events: [...possession.events, endEvent] }
        : possession),
      {
        id: createdId,
        quarter: active.quarter,
        startClock: currentClock,
        endClock: currentClock,
        lineupIds: [...onCourtLineup],
        events: [],
        pointsFor: 0,
        pointsAgainst: 0,
        side: nextSide,
        completed: false
      }
    ]);
    setSelectedPossessionId(createdId);
    setInitialPossessionSide(nextSide);
  };

  const updatePossessionDetails = (id: string, data: PossessionDetailsData) => {
    setPossessions((current) => current.map((possession) => possession.id === id
      ? {
          ...possession,
          detailsEdited: true,
          ...(data.passCount !== undefined ? { passCount: data.passCount } : {}),
          ...(data.paintTouch !== undefined ? { hadPaintTouch: data.paintTouch } : {}),
          ...(data.fastBreak !== undefined ? { wasFastBreak: data.fastBreak } : {})
        }
      : possession));
  };

  const applyOnCourtLineup = (lineupIds: string[]) => {
    const quarter = possessions[possessions.length - 1]?.quarter ?? 1;
    const id = `stint-${makeEventId()}`;
    setLineupStints((current) => changeLineup(current, lineupIds, quarter, currentClock, id));
    setOnCourtLineup([...lineupIds]);
    // Keep an untouched active possession's initial lineup aligned with saved starters.
    setPossessions((current) => current.map((possession, index) =>
      index === current.length - 1 && possession.events.length === 0
        ? { ...possession, lineupIds: [...lineupIds] } : possession));
  };

  const recordSubstitutions = (pairs: Array<{ playerOutId: string; playerInId: string }>) => {
    if (pairs.length === 0) {
      return;
    }

    const next = onCourtLineup.map((id) => pairs.find((pair) => pair.playerOutId === id)?.playerInId ?? id);
    applyOnCourtLineup(next);

    setSubstitutions((current) => [
      ...current,
      ...pairs.map((pair) => ({
        id: `sub-${Math.random().toString(16).slice(2, 10)}`,
        quarter: possessions[possessions.length - 1]?.quarter ?? 1,
        clock: currentClock,
        playerOutId: pair.playerOutId,
        playerInId: pair.playerInId
      }))
    ]);
  };

  const saveStartingFive = (quarter: number, lineupIds: string[]) => {
    setStartingLineupsByQuarter((current) => ({
      ...current,
      [quarter]: lineupIds
    }));

    if ((possessions[possessions.length - 1]?.quarter ?? 1) === quarter) {
      applyOnCourtLineup(lineupIds);
    }
  };

  const handleClockToggle = () => {
    setClockNudge(0);
    if (clockRunning) {
      setClockRunning(false);
      return;
    }

    if (onCourtLineup.length !== 5) return;

    if (clockSeconds === 10 * 60) {
      setShowStartSideModal(true);
      return;
    }

    setClockRunning(true);
  };

  const startClockWithSide = (side: "offense" | "defense") => {
    setClockNudge(0);
    if (onCourtLineup.length !== 5) return;
    setInitialPossessionSide(side);
    setPossessions((current) => current.map((possession, index) =>
      index === current.length - 1 ? { ...possession, side } : possession));
    setShowStartSideModal(false);
    setClockRunning(true);
  };

  const addRosterPlayer = () => {
    const newPlayerId = makePlayerId();
    setRoster((current) => [
      ...current,
      {
        id: newPlayerId,
        number: Number.NaN,
        name: ""
      }
    ]);
    setPendingFocusPlayerId(newPlayerId);
  };

  const updateRosterPlayer = (playerId: string, updates: Partial<Player>) => {
    setRoster((current) =>
      current.map((player) => (player.id === playerId ? { ...player, ...updates } : player))
    );
  };

  const removeRosterPlayer = (playerId: string) => {
    setRoster((current) => current.filter((player) => player.id !== playerId));
    setOnCourtLineup((current) => current.filter((id) => id !== playerId));
    setStartingLineupsByQuarter((current) => {
      const next: Record<number, string[]> = {};
      for (const [quarterKey, lineupIds] of Object.entries(current)) {
        next[Number(quarterKey)] = lineupIds.filter((id) => id !== playerId);
      }
      return next;
    });
  };

  if (!sessionStarted) {
    return (
      <div className="app-shell setup-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{competition.name}</p>
            <h1>Game Setup</h1>
          </div>
          <button type="button" className="portal-secondary" onClick={onExit}>← Games</button>
        </header>

        <section className="panel setup-panel">
          <h2>Game Details</h2>
          <p className="panel-hint">{game.gameDate} · {game.gameTime} · {game.venue}. Scheduled details are managed by the administrator.</p>

          <fieldset disabled className="scheduled-game-details setup-grid" aria-label="Scheduled game details">
            <label className="setup-field">
              Game Title
              <input
                type="text"
                value={gameDetails.gameTitle}
                onChange={(event) => setGameDetails((current) => ({ ...current, gameTitle: event.target.value }))}
              />
            </label>

            <label className="setup-field">
              Team
              <input
                type="text"
                value={gameDetails.teamName}
                onChange={(event) => setGameDetails((current) => ({ ...current, teamName: event.target.value }))}
              />
            </label>

            <label className="setup-field">
              Opponent
              <input
                type="text"
                value={gameDetails.opponentName}
                onChange={(event) => setGameDetails((current) => ({ ...current, opponentName: event.target.value }))}
              />
            </label>

            <label className="setup-field">
              Game Date
              <input
                type="date"
                value={gameDetails.gameDate}
                onChange={(event) => setGameDetails((current) => ({ ...current, gameDate: event.target.value }))}
              />
            </label>

            <label className="setup-field">
              Venue
              <input
                type="text"
                value={gameDetails.venue}
                onChange={(event) => setGameDetails((current) => ({ ...current, venue: event.target.value }))}
              />
            </label>

            <label className="setup-field full-width">
              Notes
              <textarea
                value={gameDetails.notes}
                onChange={(event) => setGameDetails((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
          </fieldset>

          <h2>Roster</h2>
          <p className="panel-hint">Edit the player list for this game.</p>
          {rosterValidation.hasErrors ? (
            <p className="panel-hint roster-validation-hint">Fix highlighted roster rows before starting the session.</p>
          ) : null}

          <div className="roster-editor">
            <div className="roster-header">
              <span>Starting 5</span>
              <span>#</span>
              <span>Player Name</span>
              <span>Action</span>
            </div>

            {roster.map((player) => (
              <div key={player.id} className="roster-item">
                <div
                  className={`roster-row ${
                    rosterValidation.blankNameIds.has(player.id)
                    || rosterValidation.missingNumberIds.has(player.id)
                    || rosterValidation.duplicateNumberIds.has(player.id)
                      ? "invalid"
                      : ""
                  }`}
                >
                  <label className="roster-starter">
                    <input
                      type="checkbox"
                      aria-label={`Start ${player.name || "unnamed player"}${Number.isFinite(player.number) ? ` #${player.number}` : ""}`}
                      checked={(startingLineupsByQuarter[1] ?? []).includes(player.id)}
                      disabled={(startingLineupsByQuarter[1]?.length ?? 0) >= 5 && !(startingLineupsByQuarter[1] ?? []).includes(player.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setStartingLineupsByQuarter((current) => ({
                          ...current,
                          1: checked ? [...(current[1] ?? []), player.id] : (current[1] ?? []).filter((id) => id !== player.id)
                        }));
                      }}
                    />
                    <span className="roster-starter-label">Starter</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    ref={(node) => {
                      rosterNumberInputRefs.current[player.id] = node;
                    }}
                    aria-invalid={rosterValidation.missingNumberIds.has(player.id) || rosterValidation.duplicateNumberIds.has(player.id)}
                    value={Number.isFinite(player.number) ? player.number : ""}
                    onChange={(event) => {
                      const rawValue = event.target.value.trim();
                      if (!rawValue) {
                        updateRosterPlayer(player.id, { number: Number.NaN });
                        return;
                      }

                      const parsed = Number(rawValue);
                      updateRosterPlayer(player.id, { number: Number.isFinite(parsed) ? parsed : Number.NaN });
                    }}
                  />
                  <input
                    type="text"
                    aria-invalid={rosterValidation.blankNameIds.has(player.id)}
                    value={player.name}
                    onChange={(event) => updateRosterPlayer(player.id, { name: event.target.value })}
                  />
                  <button type="button" className="roster-remove-btn" onClick={() => removeRosterPlayer(player.id)}>
                    Remove
                  </button>
                </div>
                {rosterValidation.blankNameIds.has(player.id)
                || rosterValidation.missingNumberIds.has(player.id)
                || rosterValidation.duplicateNumberIds.has(player.id) ? (
                  <p className="roster-error">
                    {rosterValidation.missingNumberIds.has(player.id) ? "Jersey number is required. " : ""}
                    {rosterValidation.blankNameIds.has(player.id) ? "Name is required. " : ""}
                    {rosterValidation.duplicateNumberIds.has(player.id) ? "Jersey number must be unique." : ""}
                  </p>
                ) : null}
              </div>
            ))}

            <div className="roster-actions">
              <button type="button" onClick={addRosterPlayer}>Add Player</button>
            </div>
          </div>

          <p role="status">Starting 5 selected: {startingLineupsByQuarter[1]?.length ?? 0} / 5</p>
          <div className="action-row">
            <button
              type="button"
              className="end-possession-btn"
              onClick={() => {
                saveStartingFive(1, startingLineupsByQuarter[1] ?? []);
                setSessionStarted(true);
                navigate("/configuration");
              }}
              disabled={roster.length === 0 || rosterValidation.hasErrors || startingLineupsByQuarter[1]?.length !== 5}
            >
              Start Game Session
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="active-game-header">
        <div><small>{competition.name}</small><strong>{game.gameTitle} · {game.teamName} vs {game.opponentName}</strong><small>{game.gameDate} · {game.gameTime} · {game.venue}</small></div>
        <button type="button" className="portal-secondary" onClick={() => {
          if (window.confirm("Leave this game? Live stats are not saved between game sessions yet.")) { setClockRunning(false); onExit(); }
        }}>← Games</button>
      </header>
      <section className="global-metrics">
        {statistics.offense.shot_made !== false ? <article>
          <h3>Score For</h3>
          <p>{sharedStats.pointsFor}</p>
        </article> : null}
        {statistics.defense.opp_score !== false ? <article>
          <h3>Score Against</h3>
          <p>{sharedStats.pointsAgainst}</p>
        </article> : null}
        {statistics.offense.turnover !== false ? <article>
          <h3>Turnovers</h3>
          <p>{sharedStats.turnovers}</p>
        </article> : null}
        {statistics.offense.offensive_rebound !== false ? <article>
          <h3>Offensive Rebounds</h3>
          <p>{sharedStats.offensiveRebounds}</p>
        </article> : null}
        {statistics.defense.opposition_rebound !== false ? <article>
          <h3>Opposition Rebounds</h3>
          <p>{sharedStats.oppositionRebounds}</p>
        </article> : null}
      </section>

      <section className="clock-panel" aria-label="Game clock and active possession">
        <div className="clock-time">
          <p className="clock-big" aria-label={`Time remaining ${currentClock}`}>{currentClock}</p>
          <span>Time</span>
        </div>
        <div className="active-possession">
          <strong className="possession-number">{possessions.length ? formatPossessionId(possessions[possessions.length - 1].id) : "None"}</strong>
          <span>Possession</span>
        </div>
        <div className="clock-controls">
          <div className="clock-buttons">
            <button
              type="button"
              className={`clock-toggle-btn ${clockRunning ? "is-stop" : "is-start"}${!clockRunning && clockNudge > 0 ? ` clock-nudge-${clockNudge % 2 ? "odd" : "even"}` : ""}`}
              onClick={handleClockToggle}
            >
              {clockRunning ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              className="clock-adjust-btn"
              onClick={() => shiftClock(-1)}
              disabled={clockRunning}
            >
              -1s
            </button>
            <button
              type="button"
              className="clock-adjust-btn"
              onClick={() => shiftClock(1)}
              disabled={clockRunning}
            >
              +1s
            </button>
            <button
              type="button"
              className="clock-reset-btn"
              onClick={() => { setClockRunning(false); setClockSeconds(10 * 60); }}
              disabled={clockSeconds !== 0}
            >
              Reset 10:00
            </button>
          </div>
        </div>
        {onCourtLineup.length !== 5 ? (
          <p className="lineup-error" role="alert">
            {onCourtLineup.length === 0 ? "No starting players selected." : "A complete starting five is required."}
            {" "}Select and save 5 players in <NavLink to="/configuration">Configuration</NavLink> before starting the clock.
          </p>
        ) : null}
      </section>

      {showStartSideModal ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowStartSideModal(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>Start at 10:00</h3>
            <p className="panel-hint">Choose which side starts this possession.</p>
            <div className="modal-actions start-side-actions">
              <button type="button" onClick={() => startClockWithSide("offense")}>
                Offense
              </button>
              <button type="button" onClick={() => startClockWithSide("defense")}>
                Defense
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="candidate-nav">
        <NavLink to="/tagging" end>
          Tagging
        </NavLink>
        <NavLink to="/substitutions">Substitutions</NavLink>
        <NavLink to="/configuration">Configuration</NavLink>
        <NavLink to="/matrix">Possession Matrix</NavLink>
        <NavLink to="/lineups">Lineup Differential</NavLink>
        <NavLink to="/individual">Individual Point Diff</NavLink>
      </nav>

      <main className="candidate-stage">
        <Routes>
          <Route
            path="/tagging"
            element={
              <CandidateConsole
                statistics={statistics}
                players={roster}
                possessions={possessions}
                selectedPossession={possessions[possessions.length - 1] ?? null}
                onSelectPossession={setSelectedPossessionId}
                onAddEvent={addEvent}
                onEndPossession={endPossession}
                currentClock={currentClock}
                possessionSide={initialPossessionSide}
                onCourtLineup={onCourtLineup}
                onUpdatePossessionDetails={updatePossessionDetails}
                onUpdateScoreAssist={setScoreAssist}
                onDeleteEvent={deleteEvent}
              />
            }
          />
          <Route
            path="/substitutions"
            element={
              <SubstitutionsTab
                players={roster}
                onCourtLineup={onCourtLineup}
                substitutions={substitutions}
                currentClock={currentClock}
                currentQuarter={possessions[possessions.length - 1]?.quarter ?? 1}
                onRecordSubstitutions={recordSubstitutions}
              />
            }
          />
          <Route
            path="/configuration"
            element={<ConfigurationTab players={roster} startingFive={startingLineupsByQuarter[1] ?? []}
              statistics={statistics}
              onToggleStatistic={(side, key) => setStatistics((current) => ({
                ...current, [side]: { ...current[side], [key]: current[side][key] === false }
              }))}
              locked={(startingLineupsByQuarter[1]?.length === 5) && (clockRunning || clockSeconds !== 600 || substitutions.length > 0 || possessions.some((possession) => possession.events.length > 0))}
              onSaveStartingFive={(lineupIds) => saveStartingFive(1, lineupIds)} />}
          />
          <Route
            path="/matrix"
            element={
              <CandidateGrid
                players={roster}
                possessions={possessions}
                selectedPossession={selectedPossession}
                onSelectPossession={setSelectedPossessionId}
                onAddEvent={addEvent}
                onEndPossession={endPossession}
                currentClock={currentClock}
              />
            }
          />
          <Route path="/lineups" element={<LineupDifferential players={roster} possessions={possessions} lineupStints={lineupStints} currentClock={currentClock} />} />
          <Route path="/individual" element={<IndividualDifferential players={roster} possessions={possessions} lineupStints={lineupStints} onCourtLineup={onCourtLineup} />} />
          <Route path="*" element={<Navigate to="/configuration" replace />} />
        </Routes>
      </main>
    </div>
  );
}
