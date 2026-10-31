import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resourceParameters, summarizeWhatIf } from './verify-infrastructure.mjs';

const env = { AZURE_CLIENT_ID: 'eb353f0a-266f-4ee4-b26f-0c3b364f83fd', AZURE_TENANT_ID: '5a4ed414-420a-4897-babb-87bde6cfcd33',
  AZURE_SUBSCRIPTION_ID: 'e2049f62-4ace-45fb-8ce9-220e5948bbd7', RESOURCE_GROUP: 'rg-bball-stats',
  STATIC_WEB_APP_NAME: 'bball-stats', STORAGE_ACCOUNT_NAME: 'bballstatse2049f62', AZURE_LOCATION: 'eastasia', STORAGE_LOCATION: 'australiaeast' };
const plan = { subscription: env.AZURE_SUBSCRIPTION_ID, group: env.RESOURCE_GROUP, site: env.STATIC_WEB_APP_NAME, storage: env.STORAGE_ACCOUNT_NAME };
const id = `/subscriptions/${plan.subscription}/resourceGroups/${plan.group}/providers/Microsoft.Web/staticSites/${plan.site}`;

test('resource preview requires no identity settings and cannot serialize supplied secrets', () => {
  const params = resourceParameters({ ...env, ENTRA_CLIENT_SECRET: 'never-write', STORAGE_CONNECTION_STRING: 'never-write' });
  assert.deepEqual(Object.keys(params.parameters).sort(), ['location', 'staticWebAppName', 'storageAccountName', 'storageLocation']);
  assert.ok(!JSON.stringify(params).includes('never-write'));
  assert.throws(() => resourceParameters({ ...env, RESOURCE_GROUP: '-unsafe' }));
  assert.throws(() => resourceParameters({ ...env, AZURE_SUBSCRIPTION_ID: 'wrong' }));
});

test('drift report includes paths but discards before/after resource values', () => {
  const report = summarizeWhatIf({ status: 'Succeeded', changes: [{ resourceId: id, changeType: 'Modify',
    before: { secret: 'never-write' }, after: { secret: 'never-write' },
    delta: [{ path: 'properties', propertyChangeType: 'Modify', before: 'never-write',
      children: [{ path: 'properties.stagingEnvironmentPolicy', propertyChangeType: 'Modify', after: 'never-write' }] }] }] }, plan);
  assert.equal(report[0].paths.length, 2);
  assert.ok(!JSON.stringify(report).includes('never-write'));
});

test('failed, destructive, unsupported and unexpected what-if changes fail closed', () => {
  assert.throws(() => summarizeWhatIf({ status: 'Failed', changes: [] }, plan));
  for (const changeType of ['Delete', 'Deploy', 'Unsupported']) assert.throws(() => summarizeWhatIf({ status: 'Succeeded', changes: [{ resourceId: id, changeType }] }, plan));
  assert.throws(() => summarizeWhatIf({ status: 'Succeeded', changes: [{ resourceId: `${id}-other`, changeType: 'Create' }] }, plan));
  assert.equal(summarizeWhatIf({ status: 'Succeeded', changes: [{ resourceId: `${id}/config/appsettings`, changeType: 'Ignore', before: 'never-write' }] }, plan)[0].changeType, 'Ignore');
});

test('full provisioning and verification share one resource template', () => {
  const main = readFileSync(new URL('../main.bicep', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../.github/workflows/azure-verify-infrastructure.yml', import.meta.url), 'utf8');
  assert.match(main, /module resources '\.\/resources\.bicep'/);
  assert.match(main, /dependsOn: \[resources\]/);
  assert.match(workflow, /--file infra\/resources\.bicep/);
  assert.ok(!workflow.includes('deployment group create'));
  assert.ok(!workflow.includes('secrets.'));
});