# Basketball Stats

React/TypeScript basketball live tagging with competition schedules, configurable statistics, starting lineups, substitutions, possession details, and lineup/individual point differential.

## Modes

- **Local demo (default):** run `npm install` then `npm run dev`. Demo logins are user/user and admin/admin, not secure authentication. Competitions, roster and settings use browser storage; live demo game events are **not** saved across refresh or exit.
- **Azure:** build with `VITE_BACKEND_MODE=azure`. Uses same-origin `/api/v1` and managed hosted sign-in. There is no fallback to demo identities if the API fails. Azure resources and hosted authentication have not yet been provisioned or verified.

On Windows PowerShell use `npm.cmd` instead of `npm` where execution policy blocks the PowerShell shim. Use Node 22 for deployment parity. The frontend flag is public build configuration, never a place for secrets. See [.env.example](.env.example).

## Game workflow

Administrators create/edit/archive competitions and games and assign subscriptions. Approved users can subscribe to competitions, select a game, and create or resume their own session. The creator is that session's master; an administrator does **not** gain access to another master's game record merely by being an administrator.

1. Add a roster and select five starters. Import local roster or load account defaults only with an explicit action. Save setup uploads valid rows; unfinished rows and starter choices are kept locally per account/session. Save account defaults explicitly replaces your reusable roster/stat settings using a conditional write.
2. Start the session and configure enabled statistics. Use Typing or Buttons in Tagging. Scores include Unknown, Not Applicable or a teammate assist; missed shots retain attempted point values without increasing the score.
3. The master controls the clock, starting lineup, substitutions and possession transitions. An empty side-toggle can undo the latest boundary; historical boundaries cannot be deleted independently in cloud mode. End Possession detail indicators turn from yellow to green after editing.
4. Review possessions, actual lineup stints and individual differential. Attribution follows the lineup present when a stat was recorded, not synthetic fixed time windows.

## Cloud autosave and recovery

- Valid operations are stored on this device **before** appearing successful, then uploaded in order. Operation IDs and expected revisions are retained exactly on uncertain retries, including response loss after server acceptance.
- **Saved** means the operation queue is acknowledged. **Offline / save unavailable** means pending changes remain on this device; Retry save or reconnect to upload. Opening/resuming a session still requires an API connection.
- Recovery blocks new edits until pending retries are resolved. Revision conflicts and storage failures stop editing/clock ticking; never silently overwrite remote changes. Export pending changes before choosing Discard pending and reload. Exports are recovery records, not an automatic import/rebase feature.
- One editor per session per browser origin is enforced with Web Locks (current Edge, Chrome, Firefox or Safari, HTTPS or loopback). A second browser/device is still subject to server revision conflicts. Realtime collaborators, invitations and assigned stats are deferred.
- Resume always stops the clock; no background catch-up. While running, clock checkpoints are saved every ten ticks and before stat/possession changes and normal exit. An abrupt close can lose up to ten seconds of clock progress, not acknowledged event operations.
- Browser storage is not a backup: clearing site data, private-mode cleanup or device loss can remove unsent operations and unfinished setup. Local queues/drafts and exported files contain player/game data; use a trusted device. Signing out does not erase pending data.
- The server supplies authoritative actor, revision and timestamps. Locally replayed timestamps are provisional until a server reload. Tables operation/head writes are atomic; private Blob checkpoints are secondary recovery snapshots.

## Validation and local cloud fixture

Run `node --test tests/*.test.mjs`, `npm --prefix api test`, `node --test infra/scripts/check-config.test.mjs` and `npm run build`. Install API dependencies first with `npm install --prefix api`.

Current root dependency audit reports four advisories (three moderate, one high) involving existing Vite/esbuild and React Router dependencies. Available automatic remediation proposes major upgrades; these have not been force-applied. Review and test those upgrades separately before production rollout, and do not expose development servers publicly.

For a **test-only** browser smoke test, build the API and frontend with the Azure flag, then run `node tests/manual-cloud-server.mjs`. Visit http://127.0.0.1:5179/test/login/admin or http://127.0.0.1:5179/test/login/user. The fixture uses the real API service, loopback-only listening and disposable in-memory storage. It deliberately simulates platform identities: **never deploy it or expose it through a tunnel**. It does not test Entra, Azure Storage or the SWA proxy. The regular Vite dev server alone does not provide the cloud API.

## Azure deployment setup

Implementation artifacts are ready; perform the following provisioning separately after confirming subscription, region and cost. Keep deployment disabled until configured.

1. Set up an Azure subscription and resource group, register Microsoft.Web and Microsoft.Storage as needed, and choose supported SWA/Storage regions. Review billing for **Static Web Apps Standard** (required for custom OIDC) and **StorageV2 Standard_LRS**. Infrastructure does not create the resource group.
2. Configure a Microsoft Entra External ID external tenant with email/password sign-in, an application and associated user flow. Register the production callback `https://<site-host>/.auth/login/externalid/callback`; verify the actual tenant OIDC discovery URL. The provider name is `externalid`. Do not use demo passwords.
3. Configure GitHub environments `production-infrastructure` and `production`, with required reviewers and main-branch restrictions. Create Azure workload identity federation for the infrastructure environment and grant least-privilege resource-group deployment rights. The infrastructure workflow uses OIDC, not a stored Azure login password.
4. Set infrastructure environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `AZURE_LOCATION`, `STORAGE_LOCATION`, `STATIC_WEB_APP_NAME`, `STORAGE_ACCOUNT_NAME`, `ENTRA_CLIENT_ID`, and `ENTRA_OIDC_DISCOVERY_URL`. Store `ENTRA_CLIENT_SECRET` and `APPROVED_USERS_JSON` as secrets. Approved accounts are objects with `id`, `name`, and role `user` or `administrator`; IDs must match SWA principal user IDs, not assumed email addresses.
5. Run the manual infrastructure workflow with apply **off** first and review what-if. On initial creation leave `STORAGE_CONNECTION_STRING` unset: the resource template creates storage; after obtaining its connection string privately, configure the secret and rerun the reviewed apply to wire app settings. Never paste secrets into source, chat, workflow artifacts or logs. See [infra/main.bicep](infra/main.bicep), [infra/appsettings.bicep](infra/appsettings.bicep) and [infra/scripts/prepare-parameters.mjs](infra/scripts/prepare-parameters.mjs).
6. Configure the production environment with `ENTRA_OIDC_DISCOVERY_URL`, `SITE_URL` (HTTPS origin) and secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. Enable variable `AZURE_DEPLOY_ENABLED=true` only when ready. [The deployment workflow](.github/workflows/azure-deploy.yml) builds Azure mode, renders tenant-specific OIDC into the output, stages the prebuilt managed Functions API, deploys and checks anonymous health.
7. Verify hosted sign-in, approved/unapproved users, admin versus master access, subscriptions, preference writes, save/resume, offline retry and conflicts using real storage. Anonymous health is **not** an authentication/storage readiness check. Only the trusted managed SWA proxy may reach the API: never expose a public standalone Functions endpoint trusting a client-supplied principal header.

CI and deployment definitions: [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/azure-infrastructure.yml](.github/workflows/azure-infrastructure.yml). The API contract is [api/openapi.yaml](api/openapi.yaml); shared operation validation/replay lives in [shared/session.ts](shared/session.ts) and [shared/reducer.ts](shared/reducer.ts).
