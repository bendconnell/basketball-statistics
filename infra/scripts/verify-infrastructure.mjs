import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { publicParameters } from './prepare-parameters.mjs';

export function resourceParameters(env) {
  return { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0', parameters: publicParameters(env, false).parameters };
}

export function summarizeWhatIf(result, plan) {
  if (result.status !== 'Succeeded' || !Array.isArray(result.changes)) throw Error('What-if did not succeed');
  const prefix = `/subscriptions/${plan.subscription}/resourceGroups/${plan.group}/providers`;
  const site = `${prefix}/Microsoft.Web/staticSites/${plan.site}`;
  const storage = `${prefix}/Microsoft.Storage/storageAccounts/${plan.storage}`;
  const allowed = new Set([site, storage, `${storage}/blobServices/default`, `${storage}/blobServices/default/containers/game-sessions`,
    `${storage}/tableServices/default`, ...['CompetitionData', 'SessionOperations'].map(n => `${storage}/tableServices/default/tables/${n}`)].map(id => id.toLowerCase()));
  // Only report IDs and property paths. Never retain before/after resource payloads.
  return result.changes.map(change => {
    if (!allowed.has(change.resourceId?.toLowerCase())) {
      if (change.changeType === 'Ignore') return { resourceId: change.resourceId, changeType: 'Ignore', paths: [] };
      throw Error(`Unexpected what-if target: ${change.resourceId}`);
    }
    if (!['Create', 'Modify', 'NoChange', 'Ignore'].includes(change.changeType)) throw Error(`Unsafe or inconclusive change: ${change.changeType}`);
    const paths = [];
    function visit(deltas) {
      for (const delta of deltas ?? []) {
        if (typeof delta.path === 'string') paths.push({ path: delta.path, changeType: delta.propertyChangeType });
        visit(delta.children);
      }
    }
    visit(change.delta);
    return { resourceId: change.resourceId, changeType: change.changeType, paths };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, directory] = process.argv.slice(2);
  if (action === 'parameters') {
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/parameters.json`, JSON.stringify(resourceParameters(process.env), null, 2));
  } else if (action === 'summary') {
    const plan = JSON.parse(readFileSync(`${directory}/inventory.json`, 'utf8'));
    const changes = summarizeWhatIf(JSON.parse(readFileSync(process.env.WHAT_IF_FILE, 'utf8')), plan);
    writeFileSync(`${directory}/changes.json`, JSON.stringify(changes, null, 2));
    const summary = `## Infrastructure verification (read-only)\nShared hosting/storage Bicep only; app settings and authentication are NOT verified. No create/update/delete executed.\n\n${changes.map(c => `- **${c.changeType}** ${c.resourceId}\n${c.paths.map(p => `  - ${p.changeType}: ${p.path}`).join('\n')}`).join('\n')}\n\nCreate/Modify entries are expected drift, not changes that have been applied. Budget, resource group and federation are retained bootstrap prerequisites, outside this template.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else throw Error('Use parameters <directory> or summary <directory>');
}