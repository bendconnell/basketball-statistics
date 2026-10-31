import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateDiscoveryUrl } from './render-swa-config.mjs';

function required(env, name) {
  if (!env[name]?.trim()) throw new Error(`Missing required setting: ${name}`);
  return env[name];
}

export function validateApprovedUsers(raw) {
  let users;
  try { users = JSON.parse(raw); } catch { throw new Error('APPROVED_USERS_JSON must be valid JSON'); }
  if (!Array.isArray(users) || users.length < 1 || users.length > 1000) throw new Error('Approved users must be a nonempty array (maximum 1000)');
  const ids = new Set();
  for (const user of users) {
    if (!user || typeof user !== 'object' || Object.keys(user).sort().join(',') !== 'id,name,role'
      || typeof user.id !== 'string' || !user.id.trim() || user.id.length > 256
      || typeof user.name !== 'string' || !user.name.trim() || user.name.length > 120
      || !['user', 'administrator'].includes(user.role) || ids.has(user.id)) {
      throw new Error('Approved users require unique id, name and role (user or administrator), with no extra fields');
    }
    ids.add(user.id);
  }
  return raw;
}

export function publicParameters(env) {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const name of ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'ENTRA_CLIENT_ID']) {
    if (!guid.test(required(env, name))) throw new Error(`${name} must be a UUID`);
  }
  validateDiscoveryUrl(required(env, 'ENTRA_OIDC_DISCOVERY_URL'));
  const storageAccountName = required(env, 'STORAGE_ACCOUNT_NAME');
  if (!/^[a-z0-9]{3,24}$/.test(storageAccountName)) throw new Error('Invalid Storage account name');
  const staticWebAppName = required(env, 'STATIC_WEB_APP_NAME');
  if (!/^[a-zA-Z0-9-]{2,60}$/.test(staticWebAppName)) throw new Error('Invalid Static Web App name');
  const location = required(env, 'AZURE_LOCATION');
  const resourceGroup = required(env, 'RESOURCE_GROUP');
  if (!/^[a-zA-Z0-9_.()-]{1,90}$/.test(resourceGroup) || resourceGroup.endsWith('.')) throw new Error('Invalid resource group name');
  const values = { staticWebAppName, storageAccountName, location, storageLocation: env.STORAGE_LOCATION || location, entraClientId: env.ENTRA_CLIENT_ID };
  return {
    subscriptionId: env.AZURE_SUBSCRIPTION_ID,
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_CLIENT_ID,
    resourceGroup,
    parameters: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]))
  };
}

export function secureParameters(manifest, env) {
  const parameters = { ...manifest.parameters,
    entraClientSecret: { value: required(env, 'ENTRA_CLIENT_SECRET') },
    approvedUsersJson: { value: validateApprovedUsers(required(env, 'APPROVED_USERS_JSON')) },
    storageConnectionString: { value: env.STORAGE_CONNECTION_STRING || '' }
  };
  return { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#', contentVersion: '1.0.0.0', parameters };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, path] = process.argv.slice(2);
  if (mode === 'snapshot') {
    // Check secrets before any Azure operation, but NEVER put them in an artifact.
    const manifest = publicParameters(process.env);
    secureParameters(manifest, process.env);
    mkdirSync(path, { recursive: true });
    writeFileSync(`${path}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  } else if (mode === 'secure') {
    const manifest = JSON.parse(readFileSync('infra-plan/manifest.json', 'utf8'));
    const current = publicParameters(process.env);
    if (JSON.stringify(current) !== JSON.stringify(manifest)) throw new Error('Environment parameters changed since preview; start a new run');
    writeFileSync(path, JSON.stringify(secureParameters(manifest, process.env)), { mode: 0o600 });
  } else throw new Error('Use snapshot <directory> or secure <temporary parameter file>');
}