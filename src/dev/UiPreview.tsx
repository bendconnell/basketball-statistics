import { useEffect, useState } from "react";
import { CloudApp } from "../CloudPortal";
import { CloudGameTracker } from "../CloudGameTracker";
import type { LocalAccount } from "../lib/competitions";
import type { CloudCompetition, CloudGame } from "../lib/api";
import type { SessionMetadata } from "../../shared/session";

interface Bootstrap { account: LocalAccount; competition: CloudCompetition; game: CloudGame; session: SessionMetadata; setup: SessionMetadata }

export default function UiPreview() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const view = new URLSearchParams(location.search).get("view");
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setError("");
    fetch("/__ui/bootstrap", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error(await response.text());
      const bootstrap = await response.json();
      if (live) setData(bootstrap);
    }).catch(e => {
      if (live) setError(controller.signal.aborted ? "The local UI preview did not respond within 10 seconds. Check that npm run dev:ui is running, then retry." : `Unable to load local UI preview: ${e.message}`);
    }).finally(() => window.clearTimeout(timeout));
    return () => { live = false; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <>
    {error ? <div className="app-shell"><p role="alert" className="lineup-error">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry preview</button></div> : !data ? <p role="status">Loading UI preview…</p> : view === "portal" ? <CloudApp /> :
      <CloudGameTracker {...data} session={view === "setup" ? data.setup : data.session} onExit={() => location.assign("/?view=portal")} />}
    <details className="ui-preview-tools"><summary>UI sandbox · local only</summary>
      <p>Hosted components · disposable sample data · no Azure connection</p>
      <a href="/tagging">Tagging</a>{" · "}<a href="/?view=setup">Roster setup</a>{" · "}<a href="/?view=portal">Competitions</a>
      <p><button type="button" onClick={async () => { await fetch("/__ui/reset", { method: "POST" }); location.assign("/tagging"); }}>Reset sample data</button></p>
    </details>
  </>;
}