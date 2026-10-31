import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildPlan, assertSamePlan } from './decommission.mjs';
import { summarizeWhatIf } from './verify-infrastructure.mjs';

export const settingsKeys = ['APPROVED_USERS_JSON', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'STORAGE_CONNECTION_STRING'];
const noGet = 'Cannot get the current status of the resource via the GET method.';

export function checkReviewedPreview(full, detailed, plan, adoptExisting) {
  const changes = summarizeWhatIf(detailed, plan);
  const prefix = `/subscriptions/${plan.subscription}/resourceGroups/${plan.group}/providers`;
  const storage = `${prefix}/Microsoft.Storage/storageAccounts/${plan.storage}`;
  const settingsId = `${prefix}/Microsoft.Web/staticSites/${plan.site}/config/appsettings`.toLowerCase();
  const childIds = [`${storage}/blobServices/default/containers/game-sessions`,
    ...['CompetitionData', 'SessionOperations'].map(n => `${storage}/tableServices/default/tables/${n}`)].map(id => id.toLowerCase());
  const targets = adoptExisting ? childIds : [
    `${prefix}/Microsoft.Web/staticSites/${plan.site}`, storage, `${storage}/blobServices/default`, `${storage}/tableServices/default`, ...childIds
  ].map(id => id.toLowerCase());
  const reviewed = new Map(changes.filter(c => c.changeType !== 'Ignore').map(c => [c.resourceId.toLowerCase(), c]));
  if (new Set(changes.map(c => c.resourceId.toLowerCase())).size !== changes.length) throw Error('Duplicate detailed preview target');
  if (reviewed.size !== targets.length || targets.some(id => !reviewed.has(id))) throw Error('Detailed preview has missing or unexpected deployment targets');
  // No omission/default assumptions: any property removal blocks full provisioning.
  if (changes.some(c => c.paths.some(p => p.changeType === 'Delete'))) throw Error('Property removal requires resolution before apply');
  if (full?.status !== 'Succeeded' || !Array.isArray(full.changes)) throw Error('Secure preview failed');
  const seen = new Set();
  for (const change of full.changes) {
    const id = change.resourceId?.toLowerCase();
    if (!id || seen.has(id)) throw Error('Invalid or duplicate secure preview target');
    seen.add(id);
    if (id === settingsId) {
      if (change.changeType !== 'Unsupported' || change.unsupportedReason !== noGet) throw Error('Unexpected app-settings preview result');
    } else if (reviewed.has(id)) {
      const expected = reviewed.get(id).changeType === 'Create' ? 'Create' : 'Deploy';
      if (change.changeType !== expected) throw Error('Secure preview disagrees with detailed resource preview');
    } else if (change.changeType !== 'Ignore') throw Error('Unexpected secure preview target');
  }
  if (!seen.has(settingsId) || targets.some(id => !seen.has(id))) throw Error('Secure preview is incomplete');
  return { changes, appSettings: { resourceId: settingsId, operation: 'Authoritative PUT', keys: settingsKeys,
    previewLimitation: noGet, requiresExplicitReplacementApproval: true }, adoptExisting };
}

export function assertBaseline(site, storage, blob) {
  if (site.sku?.name !== 'Standard' || site.properties?.allowConfigFileUpdates !== true
    || site.properties?.enterpriseGradeCdnStatus !== 'Disabled') throw Error('Existing SWA baseline is not approved Standard/config-updatable/CDN-disabled');
  const p = storage.properties;
  if (storage.kind !== 'StorageV2' || storage.sku?.name !== 'Standard_LRS' || p?.minimumTlsVersion !== 'TLS1_2'
    || p?.supportsHttpsTrafficOnly !== true || p?.allowBlobPublicAccess !== false || p?.allowSharedKeyAccess === false
    || p?.publicNetworkAccess !== 'Enabled' || p?.networkAcls?.defaultAction !== 'Allow') throw Error('Existing Storage security baseline failed');
  const b = blob.properties;
  if (b?.isVersioningEnabled !== true || b?.deleteRetentionPolicy?.enabled !== true || b?.deleteRetentionPolicy?.days !== 14
    || b?.deleteRetentionPolicy?.allowPermanentDelete === true || b?.containerDeleteRetentionPolicy?.enabled !== true
    || b?.containerDeleteRetentionPolicy?.days !== 14) throw Error('Existing Blob retention baseline failed');
}

export function assertLocations(site, storage, manifest) {
  // Resource providers can return display names ("East Asia") instead of
  // canonical region names ("eastasia"). Only case/whitespace are equivalent.
  function normalize(value) {
    if (typeof value !== 'string' || !/^[a-z0-9\s]+$/i.test(value) || !value.trim()) throw Error('Missing or invalid resource location');
    return value.replace(/\s/g, '').toLowerCase();
  }
  if (normalize(site.location) !== normalize(manifest.parameters.location.value)
    || normalize(storage.location) !== normalize(manifest.parameters.storageLocation.value)) throw Error('Existing resource location differs from reviewed configuration');
}

function az(args) {
  // Never propagate stdout or rich CLI errors containing app settings to logs.
  try { return JSON.parse(execFileSync('az', [...args, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error('Azure baseline/ownership query failed; response suppressed to protect secrets'); }
}
function inventory(manifest) {
  const subscription = manifest.subscriptionId, group = manifest.resourceGroup;
  const site = manifest.parameters.staticWebAppName.value, storage = manifest.parameters.storageAccountName.value;
  const common = ['--subscription', subscription, '--resource-group', group];
  const plan = buildPlan({ subscription, group, site, storage, mode: 'keep-data' },
    az(['group', 'show', '--subscription', subscription, '--name', group]), az(['resource', 'list', ...common]));
  if (manifest.parameters.adoptExisting.value) {
    if (plan.resources.length !== 2) throw Error('Adoption requires both owned root resources');
    const prefix = `/subscriptions/${subscription}/resourceGroups/${group}/providers`;
    const root = az(['resource', 'show', '--ids', `${prefix}/Microsoft.Web/staticSites/${site}`, '--api-version', '2024-11-01']);
    const account = az(['resource', 'show', '--ids', `${prefix}/Microsoft.Storage/storageAccounts/${storage}`, '--api-version', '2025-06-01']);
    const blob = az(['resource', 'show', '--ids', `${prefix}/Microsoft.Storage/storageAccounts/${storage}/blobServices/default`, '--api-version', '2025-06-01']);
    assertBaseline(root, account, blob);
    assertLocations(root, account, manifest);
  }
  // Listing uses POST, not GET. Retain names only; never emit settings values.
  const settings = plan.resources.some(r => r.type.toLowerCase() === 'microsoft.web/staticsites')
    ? az(['staticwebapp', 'appsettings', 'list', '--name', site, ...common]) : { properties: {} };
  if (!settings.properties || typeof settings.properties !== 'object' || Array.isArray(settings.properties)) throw Error('Invalid settings inventory');
  const names = Object.keys(settings.properties).sort();
  if (names.some(key => !settingsKeys.includes(key))) throw Error('Existing app settings contain unmanaged keys; refusing authoritative replacement');
  return { ...plan, existingSettingsKeys: names };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, directory] = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
  if (action === 'inventory') writeFileSync(`${directory}/inventory.json`, JSON.stringify(inventory(manifest), null, 2));
  else if (action === 'recheck') assertSamePlan(JSON.parse(readFileSync(`${directory}/inventory.json`, 'utf8')), inventory(manifest));
  else if (action === 'parameters') {
    const parameters = manifest.parameters.adoptExisting.value ? { storageAccountName: manifest.parameters.storageAccountName }
      : Object.fromEntries(Object.entries(manifest.parameters).filter(([key]) => !['entraClientId', 'adoptExisting'].includes(key)));
    writeFileSync(`${directory}/resource-parameters.json`, JSON.stringify({ parameters }));
  } else if (action === 'review') {
    const review = checkReviewedPreview(JSON.parse(readFileSync(process.env.FULL_WHAT_IF_FILE, 'utf8')),
      JSON.parse(readFileSync(process.env.RESOURCE_WHAT_IF_FILE, 'utf8')),
      JSON.parse(readFileSync(`${directory}/inventory.json`, 'utf8')), manifest.parameters.adoptExisting.value);
    writeFileSync(`${directory}/review.json`, JSON.stringify(review, null, 2));
    const summary = `## Reviewed deployment\nAdopt existing parents: ${review.adoptExisting}. No root/service PUTs in adoption mode.\n\n${review.changes.map(c => `- ${c.changeType}: ${c.resourceId}`).join('\n')}\n\nApp settings cannot be diffed by ARM (no GET). Apply requires explicit authoritative replacement approval for ONLY: ${settingsKeys.join(', ')}. Existing unmanaged keys block apply. Hosted auth/storage still unverified.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else throw Error('Unknown deployment preview action');
}