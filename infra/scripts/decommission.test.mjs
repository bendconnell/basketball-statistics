import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, buildPlan, assertSamePlan } from './decommission.mjs';
const subscription = 'e2049f62-4ace-45fb-8ce9-220e5948bbd7';
const env = { AZURE_SUBSCRIPTION_ID: subscription, RESOURCE_GROUP: 'rg-bball-stats', STATIC_WEB_APP_NAME: 'bball-stats', STORAGE_ACCOUNT_NAME: 'bballstats123', AZURE_DEPLOY_ENABLED: 'false', DECOMMISSION_MODE: 'keep-data', DECOMMISSION_APPLY: 'false' };
const prefix = `/subscriptions/${subscription}/resourceGroups/rg-bball-stats`;
const tags = { application: 'bball-stats', repository: 'bendconnell/basketball-statistics' };
const group = { id: prefix, tags };
const resources = [{ id: `${prefix}/providers/Microsoft.Web/staticSites/bball-stats`, type: 'Microsoft.Web/staticSites', tags }, { id: `${prefix}/providers/Microsoft.Storage/storageAccounts/bballstats123`, type: 'Microsoft.Storage/storageAccounts', tags }];
test('default preview preserves storage and supports already absent hosting', () => {
  const config = validateRequest(env); assert.equal(config.apply, false);
  assert.deepEqual(buildPlan(config, group, resources).deleteIds, [resources[0].id]);
  assert.deepEqual(buildPlan(config, group, resources.slice(1)).deleteIds, []);
  assert.deepEqual(buildPlan(config, group, []).deleteIds, []);
});
test('destructive apply requires exact typed target and explicit data loss acceptance', () => {
  const deleting = { ...env, DECOMMISSION_MODE: 'delete-data', DECOMMISSION_APPLY: 'true' };
  assert.throws(() => validateRequest(deleting), /confirmation/);
  deleting.DECOMMISSION_CONFIRMATION = `DELETE ${subscription}/rg-bball-stats/delete-data`;
  assert.throws(() => validateRequest(deleting), /loss/);
  const config = validateRequest({ ...deleting, ACKNOWLEDGE_DATA_LOSS: 'true' });
  assert.deepEqual(buildPlan(config, group, resources).deleteIds, resources.map(r => r.id));
});
test('deployment flag, malformed targets and injection fail closed', () => {
  for (const change of [{ AZURE_DEPLOY_ENABLED: 'true' }, { AZURE_DEPLOY_ENABLED: undefined }, { RESOURCE_GROUP: '--all' }, { RESOURCE_GROUP: 'bad;command' }, { AZURE_SUBSCRIPTION_ID: 'other' }, { DECOMMISSION_MODE: 'all' }, { STATIC_WEB_APP_NAME: '--name' }, { STORAGE_ACCOUNT_NAME: '../account' }]) assert.throws(() => validateRequest({ ...env, ...change }));
});
test('ownership, unexpected inventory and wrong subscription cannot authorize deletion', () => {
  const config = validateRequest(env);
  assert.throws(() => buildPlan(config, { ...group, tags: {} }, resources));
  assert.throws(() => buildPlan(config, { ...group, id: '/subscriptions/other/resourceGroups/rg-bball-stats' }, resources));
  for (const change of [{ tags: {} }, { id: `${prefix}/providers/Microsoft.Storage/storageAccounts/unrelated` }, { type: 'Microsoft.Compute/virtualMachines' }]) assert.throws(() => buildPlan(config, group, [{ ...resources[0], ...change }]));
  assert.throws(() => buildPlan(config, group, [...resources, resources[0]]));
});
test('apply requires unchanged preview and environment', () => {
  const config = validateRequest(env), plan = buildPlan(config, group, resources);
  assertSamePlan(plan, buildPlan(config, group, [...resources].reverse()));
  assert.throws(() => assertSamePlan(plan, buildPlan(config, group, resources.slice(1))), /changed/);
  assert.throws(() => assertSamePlan(plan, { ...plan, mode: 'delete-data' }), /changed/);
});