# Basketball Stats

React/TypeScript basketball live tagging with competition schedules, configurable statistics, starting lineups, substitutions, possession details, and lineup/individual point differential.

## Modes

- **Local demo (default):** run `npm install` then `npm run dev`. Demo logins are user/user and admin/admin, not secure authentication. Competitions, roster and settings use browser storage; live demo game events are **not** saved across refresh or exit.
- **Azure:** build with `VITE_BACKEND_MODE=azure`. Uses same-origin `/api/v1` and managed hosted sign-in. There is no fallback to demo identities if the API fails. Azure resources and hosted authentication have not yet been provisioned or verified.

On Windows PowerShell use `npm.cmd` instead of `npm` where execution policy blocks the PowerShell shim. Use Node **22.12 or newer** (Node 22 LTS for deployment parity). Vite 8 and its React plugin require this runtime floor. The frontend flag is public build configuration, never a place for secrets. See [.env.example](.env.example).

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

The toolchain uses patched Vite 8.3.5, React plugin 6.1.2, React Router DOM 7.18.5 and esbuild 0.28.2 (compatible version ranges). Frontend and API dependency audits report **zero known vulnerabilities** as of 2026-10-31. Recheck audits before production rollout; do not expose development servers publicly. Declarative BrowserRouter navigation and React 18 remain in use; no framework/SSR migration is required.

For a **test-only** browser smoke test, build the API and frontend with the Azure flag, then run `node tests/manual-cloud-server.mjs`. Visit http://127.0.0.1:5179/test/login/admin or http://127.0.0.1:5179/test/login/user. The fixture uses the real API service, loopback-only listening and disposable in-memory storage. It deliberately simulates platform identities: **never deploy it or expose it through a tunnel**. It does not test Entra, Azure Storage or the SWA proxy. The regular Vite dev server alone does not provide the cloud API.

## Azure deployment setup

Pilot resources provisioned on 2026-10-31 in `rg-bball-stats`: `bball-stats` (Static Web Apps Standard, managed API region East Asia) and `bballstatse2049f62` (StorageV2 Standard LRS, Australia East). Storage has HTTPS/TLS 1.2, anonymous Blob access disabled, Blob versioning and 14-day Blob/container soft delete. No Front Door or Defender for Storage was enabled. These are hosting/storage resources, not a verified live application: External ID, storage tables/container, application settings, deployment token and hosted smoke tests are still pending.

Budget `bball-stats-monthly-25` is created at resource-group scope for **AUD 25 monthly**, with actual-cost email alerts at 50%, 80% and 100%. It expires on 2028-09-30. Alerts are not a spending cap; hosting starts charging even before application deployment.

The GitHub `production-infrastructure` environment is restricted to main and requires `bendconnell` approval. Nonsecret resource variables and OIDC client ID are configured; `AZURE_DEPLOY_ENABLED=false`. The federated application has Contributor access only to this resource group. Its client ID is `eb353f0a-266f-4ee4-b26f-0c3b364f83fd`. This repository uses immutable GitHub OIDC subjects: `repo:bendconnell@29469650/basketball-statistics@1440436137:environment:production-infrastructure`. Verify the repository's OIDC configuration before copying older name-only subject examples. The production application environment still needs configuration.

Remaining provisioning and recreation steps follow. Keep application deployment disabled until configured.

1. Set up an Azure subscription and dedicated resource group, register Microsoft.Web and Microsoft.Storage as needed, and choose supported SWA/Storage regions. Review billing for **Static Web Apps Standard** (required for custom OIDC) and **StorageV2 Standard_LRS**. Infrastructure does not create the resource group. Tag the group `application=bball-stats` and `repository=bendconnell/basketball-statistics`; the resource template applies these ownership tags to the site/storage. Configure a monthly budget with actual-cost email alerts at 50%, 80% and 100%; alerts are not spending caps and cost data is delayed.
2. Configure a Microsoft Entra External ID external tenant with email/password sign-in, an application and associated user flow. Register the production callback `https://<site-host>/.auth/login/externalid/callback`; verify the actual tenant OIDC discovery URL. The provider name is `externalid`. Do not use demo passwords.
3. Configure GitHub environments `production-infrastructure` and `production`, with required reviewers and main-branch restrictions. Create Azure workload identity federation for the infrastructure environment and grant least-privilege resource-group deployment rights. The infrastructure workflow uses OIDC, not a stored Azure login password.
4. Set infrastructure environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `AZURE_LOCATION`, `STORAGE_LOCATION`, `STATIC_WEB_APP_NAME`, `STORAGE_ACCOUNT_NAME`, `ENTRA_CLIENT_ID`, and `ENTRA_OIDC_DISCOVERY_URL`. Store `ENTRA_CLIENT_SECRET` and `APPROVED_USERS_JSON` as secrets. Approved accounts are objects with `id`, `name`, and role `user` or `administrator`; IDs must match SWA principal user IDs, not assumed email addresses.
5. Run the manual infrastructure workflow with apply **off** first and review what-if. Leave `STORAGE_CONNECTION_STRING` unset: the resource template derives the newly created or retained storage account key server-side and passes it directly to the secure settings module, without printing it. An explicit override is optional; remove stale overrides after deleting/recreating storage. Never paste secrets into source, chat, workflow artifacts or logs. See [infra/main.bicep](infra/main.bicep), [infra/appsettings.bicep](infra/appsettings.bicep) and [infra/scripts/prepare-parameters.mjs](infra/scripts/prepare-parameters.mjs).
6. Configure the production environment with `ENTRA_OIDC_DISCOVERY_URL`, `SITE_URL` (HTTPS origin) and secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. Enable variable `AZURE_DEPLOY_ENABLED=true` only when ready. [The deployment workflow](.github/workflows/azure-deploy.yml) builds Azure mode, renders tenant-specific OIDC into the output, stages the prebuilt managed Functions API, deploys and checks anonymous health.
7. Verify hosted sign-in, approved/unapproved users, admin versus master access, subscriptions, preference writes, save/resume, offline retry and conflicts using real storage. Anonymous health is **not** an authentication/storage readiness check. Only the trusted managed SWA proxy may reach the API: never expose a public standalone Functions endpoint trusting a client-supplied principal header.

CI and deployment definitions: [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/azure-infrastructure.yml](.github/workflows/azure-infrastructure.yml). The API contract is [api/openapi.yaml](api/openapi.yaml); shared operation validation/replay lives in [shared/session.ts](shared/session.ts) and [shared/reducer.ts](shared/reducer.ts).

## Decommission and recreate

### Pipeline verification without application secrets

The decommission preview [41198997868](https://github.com/bendconnell/basketball-statistics/actions/runs/41198997868) passed Azure OIDC login, exact resource identity/ownership validation and artifact upload on 2026-10-31. It proposed the Static Web App as the only keep-data deletion target; the delete job was skipped. This verifies preview, not destructive execution.

[.github/workflows/azure-verify-infrastructure.yml](.github/workflows/azure-verify-infrastructure.yml) runs manual, read-only ARM what-if against [infra/resources.bicep](infra/resources.bicep), the same resource module used by full provisioning. It needs no External ID credentials, does not fetch storage keys/app settings, validates ownership first, and never applies changes. Approve its `production-infrastructure` job to run. Review the artifact's resource IDs, change classifications and property paths: Create/Modify means proposed drift, not applied changes. Raw before/after values are discarded. Authentication, app settings, deployment-token handling, actual apply/deletion and hosted application behavior remain unverified; the resource group, budget and OIDC identity are retained bootstrap prerequisites outside this template.

[.github/workflows/azure-decommission.yml](.github/workflows/azure-decommission.yml) is manual-only on main, preview-first, using the same protected `production-infrastructure` environment/OIDC identity. Configure required reviewers in GitHub yourself; YAML cannot enforce creation of protection rules. All three Azure lifecycle workflows share one concurrency group, so creation/deployment/deletion cannot overlap through these workflows.

1. Stop game editing and save/export any pending device changes. Set `AZURE_DEPLOY_ENABLED=false` at repository level and in any environment overriding it, and let queued deployments finish. The decommission validator requires the flag explicitly false, not absent.
2. Run decommission with apply **off**. Inspect the exact resource inventory and delete targets in the job summary/artifact. The pipeline fails closed on unexpected resources, missing ownership tags or changed inventory. It never exports app settings, identity secrets or storage keys.
3. Choose a mode:
	- **keep-data (default):** deletes only the Static Web App and its managed API. The main fixed hosting charge stops after deletion; storage remains billable at its small usage-based cost. Competitions, preferences and saved session operations/checkpoints remain.
	- **delete-data:** also deletes the exact configured storage account. **All Tables, games, preferences, operations, Blob versions and soft-deleted data in that account are permanently lost.** Blob soft delete does not protect against deleting the storage account. Back up both Tables and Blobs outside that account first, or explicitly accept loss. A frontend pending export is not a complete cloud backup.
4. Rerun with apply **on**, type exactly `DELETE <subscription-id>/<resource-group>/<mode>` and approve the protected environment job. For delete-data also check the explicit data-loss acknowledgement. The pipeline rechecks the inventory immediately before deletion and verifies target absence. It retains the resource group, budget alert, Entra tenant/application and GitHub OIDC/secrets; it does **not** delete the subscription or unrelated resources. For an already absent target the preview shows no deletion needed.

To recreate, retain the same group/name variables and run the infrastructure preview/apply again with valid Entra settings. The existing resource group means resource-group-scoped OIDC permissions and budget survive. In keep-data mode use the retained account; in delete-data mode new storage is empty (restore an external backup if required). Storage names may take time to become reusable. Refresh the new site hostname in `SITE_URL`, the Entra redirect URI `/.auth/login/externalid/callback`, and the GitHub SWA deployment-token secret. Do not assume the hostname/token or approved SWA user IDs survive recreation. Verify identities and approval mapping, enable deployment deliberately, then deploy and smoke-test before accepting stats. Old browser outboxes belong to old session IDs and must not be replayed into unrelated new sessions.

The pipelines are published. Both GitHub environments (`production-infrastructure` and `production`) require `bendconnell` approval and are restricted to main. Production `SITE_URL` is set to `https://green-plant-0b0d20b00.6.azurestaticapps.net`, but identity settings and the deployment-token secret are still absent. No teardown has been executed. Avoid using Azure Portal deletion concurrently with a lifecycle workflow; the concurrency guard only covers GitHub workflow executions.
