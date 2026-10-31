import { useEffect, useState } from "react";
import { api, request, ApiError } from "./lib/api";
import type { CloudCompetition, CloudGame } from "./lib/api";
import type { LocalAccount } from "./lib/competitions";
import type { SessionMetadata } from "../shared/session";
import { CloudGameTracker } from "./CloudGameTracker";

export function CloudApp() {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; api.me().then(value => { if (live) setAccount(value); }).catch(e => {
    if (live && !(e instanceof ApiError && e.status === 401)) setError(e.message);
  }).finally(() => { if (live) setChecking(false); }); return () => { live = false; }; }, []);
  if (checking) return <main className="login-shell"><p role="status">Checking sign-in…</p></main>;
  if (!account) return <main className="login-shell"><section className="panel login-card"><p className="eyebrow">Basketball Stats · Azure</p><h1>Sign in</h1><p>Use your approved email/password account.</p>{error ? <p role="alert" className="lineup-error">{error}</p> : null}<a className="cloud-sign-in" href="/.auth/login/externalid?post_login_redirect_uri=/">Sign in securely</a><p>Your password is handled by the identity provider, not this app.</p><button type="button" onClick={() => window.location.reload()}>Retry connection</button></section></main>;
  return <CloudPortal account={account} />;
}

function CloudPortal({ account }: { account: LocalAccount }) {
  const [competitions, setCompetitions] = useState<CloudCompetition[]>([]);
  const [selected, setSelected] = useState<CloudCompetition | null>(null);
  const [games, setGames] = useState<CloudGame[]>([]);
  const [game, setGame] = useState<CloudGame | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [users, setUsers] = useState<LocalAccount[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<CloudCompetition | null>(null);
  const [draft, setDraft] = useState<CloudGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createId, setCreateId] = useState<string | null>(null);
  const admin = account.role === "administrator";
  const refresh = async () => {
    const list = await api.competitions(); setCompetitions(list);
    if (selected) { setSelected(list.find(c => c.id === selected.id) ?? null); setGames(await api.games(selected.id)); }
    if (game) setSessions(await api.sessions(game.id));
  };
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); } };
  useEffect(() => { void run(async () => { setCompetitions(await api.competitions()); if (admin) setUsers(await api.users()); }); }, [account.id]);
  if (session && game && selected) return <CloudGameTracker account={account} session={session} game={game} competition={selected} onExit={() => { setSession(null); void run(refresh); }} />;
  const blank: CloudGame = { id: "", competitionId: selected?.id ?? "", gameTitle: "", teamName: "", opponentName: "", gameDate: "", gameTime: "", venue: "", notes: "", archived: false, etag: "" };
  return <div className="app-shell competition-shell">
    <header className="portal-header"><div><p className="eyebrow">Basketball Stats · {account.name}</p><h1>{game ? game.gameTitle : selected ? selected.name : admin ? "Manage competitions" : "My competitions"}</h1></div><a href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a></header>
    {error ? <p className="lineup-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void run(refresh)}>Reload lists</button></p> : null}
    {busy ? <p role="status">Working…</p> : null}
    <fieldset disabled={busy} className="cloud-controls">
      {game ? <>
        <button type="button" onClick={() => { setGame(null); setCreateId(null); }}>← Games</button>
        <p>{game.teamName} vs {game.opponentName} · {game.gameDate} · {game.gameTime} · {game.venue}</p>
        <button type="button" onClick={() => void run(async () => {
          const key = `bball-stats.session-create.v1:${encodeURIComponent(account.id)}:${game.id}`;
          let id = createId ?? sessionStorage.getItem(key);
          if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); setCreateId(id); }
          const created = await api.createSession(game.id, id); sessionStorage.removeItem(key); setCreateId(null); setSession(created);
        })}>New session (you are master)</button>
        <div className="portal-card-grid">{sessions.map(s => <article className="panel" key={s.id}><h2>{s.status === "setup" ? "Game setup" : "Game in progress"}</h2><p>Started {new Date(s.createdAt).toLocaleString()} · revision {s.revision}</p><button type="button" onClick={() => setSession(s)}>Resume session</button></article>)}</div>
        {!sessions.length ? <p>No saved sessions for your account yet.</p> : null}
      </> : selected ? <>
        <button type="button" onClick={() => { setSelected(null); setDraft(null); }}>← Competitions</button>
        {admin ? <div className="portal-toolbar"><div>{users.filter(u => u.role === "user").map(u => <label key={u.id}><input type="checkbox" checked={selected.subscriberIds.includes(u.id)} onChange={() => void run(async () => { await request(`competitions/${selected.id}/subscriptions/${encodeURIComponent(u.id)}`, selected.subscriberIds.includes(u.id) ? "DELETE" : "PUT"); await refresh(); })} /> {u.name} subscribed </label>)}</div><button type="button" onClick={() => setDraft(blank)}>Add game</button></div> : null}
        {draft ? <section className="panel"><h2>{draft.id ? "Edit game" : "New game"}</h2><form onSubmit={e => { e.preventDefault(); void run(async () => {
          const { gameTitle, teamName, opponentName, gameDate, gameTime, venue, notes } = draft;
          await request(draft.id ? `games/${draft.id}` : `competitions/${selected.id}/games`, draft.id ? "PATCH" : "POST", { gameTitle, teamName, opponentName, gameDate, gameTime, venue, notes }, draft.etag || undefined); setDraft(null); await refresh();
        }); }}><div className="setup-grid">{([ ["gameTitle", "Game title", "text"], ["teamName", "Team", "text"], ["opponentName", "Opponent", "text"], ["gameDate", "Date", "date"], ["gameTime", "Time", "time"], ["venue", "Venue", "text"] ] as const).map(([key, label, type]) => <label className="setup-field" key={key}>{label}<input required type={type} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}<label className="setup-field full-width">Notes<textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label></div><div className="action-row"><button type="submit">Save game</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div></form></section> : null}
        <div className="portal-card-grid">{games.map(g => <article className="panel portal-card" key={g.id}><h2>{g.gameTitle}</h2><strong>{g.teamName} vs {g.opponentName}</strong><p>{g.gameDate} · {g.gameTime}<br />{g.venue}</p><div className="portal-card-actions"><button type="button" onClick={() => void run(async () => { const list = await api.sessions(g.id); setSessions(list); setGame(g); setCreateId(null); })}>Open game</button>{admin ? <><button type="button" onClick={() => setDraft(g)}>Edit game</button><button type="button" onClick={() => { if (window.confirm(`Archive ${g.gameTitle}? Saved records will be retained.`)) void run(async () => { await request(`games/${g.id}`, "DELETE", undefined, g.etag); await refresh(); }); }}>Archive game</button></> : null}</div></article>)}</div>
        {!games.length ? <p>No games scheduled yet.</p> : null}
      </> : <>
        {admin ? <section className="panel"><h2>{editing ? "Edit competition" : "New competition"}</h2><form className="competition-form" onSubmit={e => { e.preventDefault(); void run(async () => { await request(editing ? `competitions/${editing.id}` : "competitions", editing ? "PATCH" : "POST", { name: name.trim() }, editing?.etag); setEditing(null); setName(""); await refresh(); }); }}><label className="setup-field">Competition name<input required value={name} onChange={e => setName(e.target.value)} /></label><button type="submit">{editing ? "Save competition" : "Create competition"}</button>{editing ? <button type="button" onClick={() => { setEditing(null); setName(""); }}>Cancel</button> : null}</form></section> : null}
        <div className="portal-card-grid">{competitions.map(c => { const subscribed = c.subscriberIds.includes(account.id); return <article className="panel portal-card" key={c.id}><h2>{c.name}</h2>{admin || subscribed ? <button type="button" onClick={() => void run(async () => { setGames(await api.games(c.id)); setSelected(c); })}>View games</button> : null}{!admin ? <button type="button" onClick={() => void run(async () => { await request(`competitions/${c.id}/subscriptions/${encodeURIComponent(account.id)}`, subscribed ? "DELETE" : "PUT"); await refresh(); })}>{subscribed ? "Unsubscribe" : "Subscribe"}</button> : <div className="portal-card-actions"><button type="button" onClick={() => { setEditing(c); setName(c.name); }}>Edit competition</button><button type="button" onClick={() => { if (window.confirm(`Archive ${c.name}? Saved records will be retained.`)) void run(async () => { await request(`competitions/${c.id}`, "DELETE", undefined, c.etag); await refresh(); }); }}>Archive competition</button></div>}</article>; })}</div>
        {!competitions.length ? <p>No competitions available yet.</p> : null}
      </>}
    </fieldset>
  </div>;
}