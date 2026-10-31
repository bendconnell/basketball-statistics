import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ResourceIdOnly avoids logging settings/keys, but its Deploy classification
// does not establish whether an existing resource changes. Never treat that,
// Unsupported, or a successful CLI exit alone as permission to apply.
export function checkFullPreview(result) {
  if (result?.status !== 'Succeeded' || !Array.isArray(result.changes) || result.changes.length === 0) {
    throw new Error('Full infrastructure preview failed or returned no reviewable changes');
  }
  const allowed = new Set(['Create', 'Modify', 'NoChange', 'Ignore']);
  if (result.changes.some(change => !allowed.has(change.changeType) || typeof change.resourceId !== 'string')) {
    throw new Error('Full preview contains destructive or inconclusive classifications (Deploy/Unsupported). Apply blocked; review resource drift and app settings separately without exposing secrets.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  // Only IDs/classifications can reach logs, even if the input format changes.
  console.log(JSON.stringify({ status: result.status, changes: result.changes?.map(({ resourceId, changeType }) => ({ resourceId, changeType })) }, null, 2));
  checkFullPreview(result);
}