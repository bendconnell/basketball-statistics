import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertBaseline, assertLocations, checkReviewedPreview } from './deployment-preview.mjs';

const plan = { subscription: '00000000-0000-0000-0000-000000000001', group: 'rg', site: 'site', storage: 'storage' };
const prefix = `/subscriptions/${plan.subscription}/resourceGroups/rg/providers`;
const account = `${prefix}/Microsoft.Storage/storageAccounts/storage`;
const ids = [`${account}/blobServices/default/containers/game-sessions`,
  `${account}/tableServices/default/tables/CompetitionData`, `${account}/tableServices/default/tables/SessionOperations`];
function fixture() {
  const detailed = { status: 'Succeeded', changes: ids.map(resourceId => ({ resourceId, changeType: 'Create' })) };
  const full = { status: 'Succeeded', changes: [...detailed.changes.map(c => ({ ...c })), {
    resourceId: `${prefix}/Microsoft.Web/staticSites/site/config/appsettings`, changeType: 'Unsupported',
    unsupportedReason: 'Cannot get the current status of the resource via the GET method.' }] };
  return { detailed, full };
}
test('adoption permits only exact reviewed children and the known no-GET settings endpoint', () => {
  const { full, detailed } = fixture();
  const report = checkReviewedPreview(full, detailed, plan, true);
  assert.equal(report.appSettings.requiresExplicitReplacementApproval, true);
  assert.equal(report.appSettings.keys.length, 4);
  full.changes[0].changeType = 'Unsupported';
  assert.throws(() => checkReviewedPreview(full, detailed, plan, true));
});
test('missing, duplicate, disagreeing, destructive and unexpected targets fail closed', () => {
  for (const mutate of [
    f => f.full.changes.pop(), f => f.full.changes.push(f.full.changes[0]),
    f => { f.full.changes[3].unsupportedReason = 'Different error'; },
    f => { f.full.changes[0].changeType = 'Deploy'; },
    f => { f.detailed.changes[0].delta = [{ path: 'properties.publicAccess', propertyChangeType: 'Delete' }]; },
    f => f.detailed.changes.pop(),
    f => f.detailed.changes.push(f.detailed.changes[0]),
    f => f.full.changes.push({ resourceId: account, changeType: 'Deploy' }),
    f => { f.detailed.changes[0].changeType = 'Delete'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => checkReviewedPreview(f.full, f.detailed, plan, true));
  }
});
test('ID-only Deploy requires independently reviewed nonsecret resource details', () => {
  const { full, detailed } = fixture();
  detailed.changes[0].changeType = 'NoChange'; full.changes[0].changeType = 'Deploy';
  assert.doesNotThrow(() => checkReviewedPreview(full, detailed, plan, true));
});
test('adopted parents must retain approved security and retention baseline', () => {
  const site = { sku: { name: 'Standard' }, properties: { allowConfigFileUpdates: true, enterpriseGradeCdnStatus: 'Disabled' } };
  const storage = { kind: 'StorageV2', sku: { name: 'Standard_LRS' }, properties: {
    minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false,
    publicNetworkAccess: 'Enabled', networkAcls: { defaultAction: 'Allow' } } };
  const blob = { properties: { isVersioningEnabled: true, deleteRetentionPolicy: { enabled: true, days: 14 },
    containerDeleteRetentionPolicy: { enabled: true, days: 14 } } };
  assert.doesNotThrow(() => assertBaseline(site, storage, blob));
  blob.properties.deleteRetentionPolicy.allowPermanentDelete = true;
  assert.throws(() => assertBaseline(site, storage, blob));
});
test('adoption Bicep deploys children only and never service/account parents', () => {
  const source = readFileSync(new URL('../data.bicep', import.meta.url), 'utf8');
  for (const name of ['storage', 'blobService', 'tableService']) assert.match(source, new RegExp(`resource ${name} '[^']+' existing`));
  assert.match(source, /publicAccess: 'None'/);
  assert.match(source, /defaultEncryptionScope: '\$account-encryption-key'/);
  assert.match(source, /denyEncryptionScopeOverride: false/);
  assert.match(source, /\['CompetitionData', 'SessionOperations'\]/);
});

test('Azure display location names match their canonical region names', () => {
  const manifest = { parameters: { location: { value: 'eastasia' }, storageLocation: { value: 'australiaeast' } } };
  for (const location of ['East Asia', 'eastasia', ' EAST ASIA ']) {
    assert.doesNotThrow(() => assertLocations({ location }, { location: 'Australia East' }, manifest));
  }
});

test('region normalization still rejects different, missing and malformed locations', () => {
  const manifest = { parameters: { location: { value: 'eastasia' }, storageLocation: { value: 'australiaeast' } } };
  for (const location of ['Southeast Asia', 'Global', '', undefined, null, 'east-asia', 123]) {
    assert.throws(() => assertLocations({ location }, { location: 'Australia East' }, manifest));
  }
  assert.throws(() => assertLocations({ location: 'East Asia' }, { location: 'Australia Southeast' }, manifest));
});