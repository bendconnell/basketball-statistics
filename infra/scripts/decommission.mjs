import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ownership = { application: 'bball-stats', repository: 'bendconnell/basketball-statistics' };
export function validateRequest(env) {
  const subscription = env.AZURE_SUBSCRIPTION_ID;
  const group = env.RESOURCE_GROUP;
  const site = env.STATIC_WEB_APP_NAME;
  const storage = env.STORAGE_ACCOUNT_NAME;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(subscription ?? '')) throw Error('Invalid subscription ID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.()-]{0,89}$/.test(group ?? '') || group.endsWith('.')) throw Error('Invalid resource group');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{1,59}$/.test(site ?? '')) throw Error('Invalid site name');
  if (!/^[a-z0-9]{3,24}$/.test(storage ?? '')) throw Error('Invalid storage name');
  if (!['keep-data', 'delete-data'].includes(env.DECOMMISSION_MODE)) throw Error('Invalid decommission mode');
  if (!['true', 'false'].includes(env.DECOMMISSION_APPLY)) throw Error('Invalid apply flag');
  // A missing flag is not evidence that deployment has been disabled.
  if (env.AZURE_DEPLOY_ENABLED !== 'false') throw Error('Set AZURE_DEPLOY_ENABLED=false before decommissioning');
  const confirmation = `DELETE ${subscription}/${group}/${env.DECOMMISSION_MODE}`;
  const apply = env.DECOMMISSION_APPLY === 'true';
  if (apply && env.DECOMMISSION_CONFIRMATION !== confirmation) throw Error(`Exact confirmation required: ${confirmation}`);
  if (apply && env.DECOMMISSION_MODE === 'delete-data' && env.ACKNOWLEDGE_DATA_LOSS !== 'true') throw Error('Permanent data loss must be acknowledged');
  return { subscription, group, site, storage, mode: env.DECOMMISSION_MODE, apply, confirmation };
}
function owned(tags) { return Object.entries(ownership).every(([key, value]) => tags?.[key] === value); }
export function buildPlan(config, group, inventory) {
  const prefix = `/subscriptions/${config.subscription}/resourceGroups/${config.group}`;
  if (group.id?.toLowerCase() !== prefix.toLowerCase() || !owned(group.tags)) throw Error('Resource group ownership or identity mismatch');
  if (!Array.isArray(inventory)) throw Error('Invalid inventory');
  const siteId = `${prefix}/providers/Microsoft.Web/staticSites/${config.site}`;
  const storageId = `${prefix}/providers/Microsoft.Storage/storageAccounts/${config.storage}`;
  const expected = new Map([[siteId.toLowerCase(), 'microsoft.web/staticsites'], [storageId.toLowerCase(), 'microsoft.storage/storageaccounts']]);
  const resources = inventory.map(resource => {
    const id = resource.id?.toLowerCase();
    const type = resource.type?.toLowerCase();
    if (!id || !expected.has(id) || type !== expected.get(id) || !owned(resource.tags)) throw Error(`Unexpected or unowned resource: ${resource.id ?? 'unknown'}`);
    return { id: resource.id, type: resource.type, tags: ownership };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(resources.map(r => r.id.toLowerCase())).size !== resources.length) throw Error('Duplicate inventory resource');
  return { subscription: config.subscription, group: config.group, site: config.site, storage: config.storage, mode: config.mode,
    resources, deleteIds: [siteId, ...(config.mode === 'delete-data' ? [storageId] : [])].filter(id => resources.some(r => r.id.toLowerCase() === id.toLowerCase())) };
}
export function assertSamePlan(reviewed, current) {
  if (JSON.stringify(reviewed) !== JSON.stringify(current)) throw Error('Inventory or environment changed since preview; start a new run');
}
function azure(args) { return execFileSync('az', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim(); }
function inventory(config) {
  const args = ['--subscription', config.subscription, '--resource-group', config.group, '--output', 'json'];
  const group = JSON.parse(azure(['group', 'show', '--subscription', config.subscription, '--name', config.group, '--output', 'json']));
  return buildPlan(config, group, JSON.parse(azure(['resource', 'list', ...args])));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = validateRequest(process.env);
  const [action, file] = process.argv.slice(2);
  if (action === 'validate') console.log('Decommission request validated; no resources changed.');
  else if (action === 'preview') {
    const plan = inventory(config); writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
    const summary = `## Decommission preview\nMode: ${plan.mode}\n\nDelete targets:\n${plan.deleteIds.map(id => `- ${id}`).join('\n') || '- None (already absent)'}\n\nResource group, budget, Entra identities and GitHub configuration remain. Storage survives only in keep-data mode. Storage-account deletion permanently loses Tables and Blob versions; soft delete is NOT an account backup.\n\nConfirmation: ${config.confirmation}\n`;
    console.log(summary); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else if (action === 'apply') {
    if (!config.apply) throw Error('Apply was not authorized');
    const reviewed = JSON.parse(readFileSync(file, 'utf8')); const current = inventory(config); assertSamePlan(reviewed, current);
    for (const id of reviewed.deleteIds) {
      azure(['resource', 'delete', '--ids', id, '--subscription', config.subscription, '--output', 'none']);
      azure(['resource', 'wait', '--ids', id, '--subscription', config.subscription, '--deleted', '--timeout', '900']);
    }
    const remaining = inventory(config);
    if (remaining.resources.some(r => reviewed.deleteIds.some(id => id.toLowerCase() === r.id.toLowerCase()))) throw Error('Deletion is still incomplete; inspect Azure before restarting');
    console.log('Verified deletion. Deployment stays disabled. Resource group/budget retained; refresh site hostname, callback and deployment token when recreated.');
  } else throw Error('Use validate, preview <plan-file>, or apply <plan-file>');
}