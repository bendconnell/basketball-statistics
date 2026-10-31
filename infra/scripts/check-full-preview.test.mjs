import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkFullPreview } from './check-full-preview.mjs';

test('full preview blocks successful but inconclusive or destructive results', () => {
  for (const changeType of ['Deploy', 'Unsupported', 'Delete', 'Unknown']) {
    assert.throws(() => checkFullPreview({ status: 'Succeeded', changes: [{ resourceId: '/resource', changeType }] }));
  }
  assert.throws(() => checkFullPreview({ status: 'Failed', changes: [] }));
  assert.throws(() => checkFullPreview({ status: 'Succeeded', changes: [] }));
  assert.throws(() => checkFullPreview({ status: 'Succeeded' }));
  assert.doesNotThrow(() => checkFullPreview({ status: 'Succeeded', changes: [{ resourceId: '/resource', changeType: 'Create' }] }));
});

test('protected apply depends on a checked secret-safe preview', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/azure-infrastructure.yml', import.meta.url), 'utf8');
  assert.match(workflow, /--result-format ResourceIdOnly/);
  assert.match(workflow, /node infra\/scripts\/check-full-preview\.mjs "\$whatif"/);
  assert.match(workflow, /needs: preview/);
});