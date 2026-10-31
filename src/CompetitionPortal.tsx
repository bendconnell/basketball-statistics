import { useEffect, useState } from "react";
import { COMPETITIONS_STORAGE_KEY, loadCompetitions, loginLocalAccount } from "./lib/competitions";
import type { Competition, LocalAccount, ScheduledGame } from "./lib/competitions";

export function LoginScreen({ onLogin }: { onLogin: (account: LocalAccount) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="login-shell">
      <section className="panel login-card">
        <p className="eyebrow">Basketball Stats</p>
        <h1>Welcome back</h1>
        <p>Sign in to your competitions and games.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          const account = loginLocalAccount(username, password);
          if (account) onLogin(account);
          else setError("Username or password is incorrect.");
        }}>
          <label className="setup-field">Username<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="setup-field">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error ? <p role="alert" className="lineup-error">{error}</p> : null}
          <button type="submit">Sign in</button>
        </form>
        <div className="prototype-notice">
          <strong>Local prototype accounts</strong>
          <p>User: <b>user / user</b><br />Administrator: <b>admin / admin</b></p>
          <small>Demo credentials only. Data is saved in this browser, not shared between devices. Do not use real passwords or sensitive data.</small>
        </div>
      </section>
    </main>
  );
}

const blankGame = (competitionId: string): ScheduledGame => ({
  id: "", competitionId, gameTitle: "", teamName: "", opponentName: "", gameDate: "", gameTime: "", venue: "", notes: ""
});

export function CompetitionPortal({ account, onLogout, onSelectGame }: {
  account: LocalAccount;
  onLogout: () => void;
  onSelectGame: (game: ScheduledGame, competition: Competition) => void;
}) {
  const [store, setStore] = useState(loadCompetitions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [competitionName, setCompetitionName] = useState("");
  const [editingCompetitionId, setEditingCompetitionId] = useState<string | null>(null);
  const [gameDraft, setGameDraft] = useState<ScheduledGame | null>(null);
  const [storageError, setStorageError] = useState("");
  const admin = account.role === "administrator";
  const selected = store.competitions.find((competition) => competition.id === selectedId);
  const visible = store.competitions.filter((competition) => admin || competition.subscriberIds.includes(account.id));
  useEffect(() => {
    try { localStorage.setItem(COMPETITIONS_STORAGE_KEY, JSON.stringify(store)); setStorageError(""); }
    catch { setStorageError("Browser storage is unavailable. Changes will be lost when this page closes."); }
  }, [store]);
  const toggleSubscription = (competitionId: string, userId: string) => {
    setStore((current) => ({ ...current, competitions: current.competitions.map((competition) => competition.id === competitionId
      ? { ...competition, subscriberIds: competition.subscriberIds.includes(userId)
        ? competition.subscriberIds.filter((id) => id !== userId) : [...competition.subscriberIds, userId] }
      : competition) }));
  };
  return (
    <div className="app-shell competition-shell">
      <header className="portal-header">
        <div><p className="eyebrow">Basketball Stats · {account.name}</p><h1>{selected ? selected.name : admin ? "Manage competitions" : "My competitions"}</h1></div>
        <button type="button" className="portal-secondary" onClick={onLogout}>Sign out</button>
      </header>
      {storageError ? <p role="alert" className="lineup-error">{storageError}</p> : null}
      {selected ? (
        <>
          <button type="button" className="portal-secondary" onClick={() => { setSelectedId(null); setGameDraft(null); }}>← Competitions</button>
          {admin ? <div className="portal-toolbar"><label><input type="checkbox" checked={selected.subscriberIds.includes("user")} onChange={() => toggleSubscription(selected.id, "user")} /> User subscribed</label><button type="button" onClick={() => setGameDraft(blankGame(selected.id))}>Add game</button></div> : null}
          {gameDraft && admin ? (
            <section className="panel">
              <h2>{gameDraft.id ? "Edit game" : "New game"}</h2>
              <form onSubmit={(event) => {
                event.preventDefault();
                const game = { ...gameDraft, id: gameDraft.id || crypto.randomUUID(), gameTitle: gameDraft.gameTitle.trim(), teamName: gameDraft.teamName.trim(), opponentName: gameDraft.opponentName.trim(), venue: gameDraft.venue.trim() };
                if (!game.gameTitle || !game.teamName || !game.opponentName || !game.venue) return;
                setStore((current) => ({ ...current, games: gameDraft.id ? current.games.map((entry) => entry.id === game.id ? game : entry) : [...current.games, game] }));
                setGameDraft(null);
              }}>
                <div className="setup-grid">
                  {([
                    ["gameTitle", "Game title", "text"], ["teamName", "Team", "text"], ["opponentName", "Opponent", "text"],
                    ["gameDate", "Date", "date"], ["gameTime", "Time", "time"], ["venue", "Venue", "text"]
                  ] as const).map(([key, label, type]) => <label className="setup-field" key={key}>{label}<input required type={type} value={gameDraft[key]} onChange={(event) => setGameDraft({ ...gameDraft, [key]: event.target.value })} /></label>)}
                  <label className="setup-field full-width">Notes<textarea value={gameDraft.notes} onChange={(event) => setGameDraft({ ...gameDraft, notes: event.target.value })} /></label>
                </div>
                <div className="action-row"><button type="submit">Save game</button><button type="button" className="portal-secondary" onClick={() => setGameDraft(null)}>Cancel</button></div>
              </form>
            </section>
          ) : null}
          <div className="portal-card-grid">
            {store.games.filter((game) => game.competitionId === selected.id).sort((a, b) => `${a.gameDate} ${a.gameTime}`.localeCompare(`${b.gameDate} ${b.gameTime}`)).map((game) => (
              <article className="panel portal-card" key={game.id}>
                <h2>{game.gameTitle}</h2><strong>{game.teamName} vs {game.opponentName}</strong>
                <p>{game.gameDate} · {game.gameTime}<br />{game.venue}</p>
                {game.notes ? <p>{game.notes}</p> : null}
                <div className="portal-card-actions">
                  <button type="button" onClick={() => onSelectGame(game, selected)}>Open game</button>
                  {admin ? <><button type="button" className="portal-secondary" onClick={() => setGameDraft({ ...game })}>Edit game</button><button type="button" className="portal-secondary" onClick={() => {
                    if (window.confirm(`Delete ${game.gameTitle}?`)) { setStore((current) => ({ ...current, games: current.games.filter((entry) => entry.id !== game.id) })); if (gameDraft?.id === game.id) setGameDraft(null); }
                  }}>Delete game</button></> : null}
                </div>
              </article>
            ))}
          </div>
          {!store.games.some((game) => game.competitionId === selected.id) ? <p>No games scheduled yet.{admin ? " Add the first game above." : " The administrator can add games here."}</p> : null}
        </>
      ) : (
        <>
          {admin ? <section className="panel"><h2>{editingCompetitionId ? "Edit competition" : "New competition"}</h2><form className="competition-form" onSubmit={(event) => {
            event.preventDefault();
            const name = competitionName.trim();
            if (!name) return;
            setStore((current) => ({ ...current, competitions: editingCompetitionId
              ? current.competitions.map((competition) => competition.id === editingCompetitionId ? { ...competition, name } : competition)
              : [...current.competitions, { id: crypto.randomUUID(), name, subscriberIds: ["user"] }] }));
            setCompetitionName(""); setEditingCompetitionId(null);
          }}><label className="setup-field">Competition name<input required placeholder="U18 Div1 Summer Season" value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} /></label><button type="submit">{editingCompetitionId ? "Save competition" : "Create competition"}</button>{editingCompetitionId ? <button type="button" className="portal-secondary" onClick={() => { setEditingCompetitionId(null); setCompetitionName(""); }}>Cancel</button> : null}</form><small>New competitions subscribe the initial User account automatically.</small></section> : null}
          <div className="portal-card-grid">
            {visible.map((competition) => <article className="panel portal-card" key={competition.id}><h2>{competition.name}</h2><p>{store.games.filter((game) => game.competitionId === competition.id).length} games</p><div className="portal-card-actions"><button type="button" onClick={() => setSelectedId(competition.id)}>View games</button>{admin ? <><button type="button" className="portal-secondary" onClick={() => { setEditingCompetitionId(competition.id); setCompetitionName(competition.name); }}>Edit competition</button><button type="button" className="portal-secondary" onClick={() => {
              if (window.confirm(`Delete ${competition.name} and all its games?`)) {
                setStore((current) => ({ competitions: current.competitions.filter((entry) => entry.id !== competition.id), games: current.games.filter((entry) => entry.competitionId !== competition.id) }));
                if (editingCompetitionId === competition.id) { setEditingCompetitionId(null); setCompetitionName(""); }
              }
            }}>Delete competition</button></> : <button type="button" className="portal-secondary" onClick={() => toggleSubscription(competition.id, account.id)}>Unsubscribe</button>}</div></article>)}
          </div>
          {!visible.length ? <p>{admin ? "Create your first competition to schedule games." : "You have no subscribed competitions yet."}</p> : null}
          {!admin && store.competitions.some((competition) => !competition.subscriberIds.includes(account.id)) ? <section className="panel"><h2>Available competitions</h2>{store.competitions.filter((competition) => !competition.subscriberIds.includes(account.id)).map((competition) => <div className="portal-toolbar" key={competition.id}><strong>{competition.name}</strong><button type="button" onClick={() => toggleSubscription(competition.id, account.id)}>Subscribe</button></div>)}</section> : null}
        </>
      )}
    </div>
  );
}