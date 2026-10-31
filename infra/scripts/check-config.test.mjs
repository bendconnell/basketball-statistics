import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderConfig, validateDiscoveryUrl } from './render-swa-config.mjs';
import { validateApprovedUsers } from './prepare-parameters.mjs';

test('discovery rendering accepts the full HTTPS CIAM URL and leaves the template unchanged', () => {
  const template = JSON.parse(readFileSync(new URL('../../public/staticwebapp.config.json', import.meta.url), 'utf8'));
  const url = 'https://tenant.ciamlogin.com/tenant-id/v2.0/.well-known/openid-configuration?test=1';
  const result = renderConfig(template, url);
  assert.equal(result.auth.identityProviders.customOpenIdConnectProviders.externalid.registration.openIdConnectConfiguration.wellKnownOpenIdConfiguration, url);
  assert.match(template.auth.identityProviders.customOpenIdConnectProviders.externalid.registration.openIdConnectConfiguration.wellKnownOpenIdConfiguration, /REPLACE/);
  assert.equal(result.platform.apiRuntime, 'node:22');
  assert.deepEqual(result.routes[0], { route: '/api/v1/health', methods: ['GET'], allowedRoles: ['anonymous'] });
  assert.deepEqual(result.routes.find(route => route.route === '/api/*').allowedRoles, ['authenticated']);
  assert.ok(result.navigationFallback.exclude.includes('/api/*'));
  assert.ok(result.navigationFallback.exclude.includes('/.auth/*'));
  assert.equal(result.responseOverrides, undefined); // API errors must not become login HTML.
});

test('discovery validation fails closed', () => {
  for (const url of ['', 'http://tenant.ciamlogin.com/test', 'https://ciamlogin.com/test',
    'https://tenant.ciamlogin.com.evil.example/test', 'https://evil.example/test',
    'https://user:secret@tenant.ciamlogin.com/test', 'https://tenant.ciamlogin.com:444/test',
    'https://tenant.ciamlogin.com/test#fragment', 'https://REPLACE.ciamlogin.com/test']) {
    assert.throws(() => validateDiscoveryUrl(url));
  }
});

test('approval configuration rejects missing, duplicate, extra-field and client-granted roles', () => {
  const user = { id: 'verified-swa-id', name: 'Approved person', role: 'user' };
  assert.equal(validateApprovedUsers(JSON.stringify([user])), JSON.stringify([user]));
  for (const value of ['', '[]', '{}', JSON.stringify([user, user]),
    JSON.stringify([{ ...user, role: 'admin' }]), JSON.stringify([{ ...user, userRoles: ['administrator'] }])]) {
    assert.throws(() => validateApprovedUsers(value));
  }
});