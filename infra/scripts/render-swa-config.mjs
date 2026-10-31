import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateDiscoveryUrl(value) {
  if (!value || value !== value.trim() || /REPLACE|[<>]/i.test(value)) throw new Error('ENTRA_OIDC_DISCOVERY_URL is required and must not contain placeholders');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ciamlogin.com')
    || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw new Error('Discovery URL must use HTTPS on a tenant hostname ending .ciamlogin.com, without credentials, fragment, or a non-443 port');
  }
  // Keep the full tenant discovery URL, including its path/query; never append a guessed issuer path.
  return url.href;
}

export function renderConfig(template, discoveryUrl) {
  const config = structuredClone(template);
  config.auth.identityProviders.customOpenIdConnectProviders.externalid.registration
    .openIdConnectConfiguration.wellKnownOpenIdConfiguration = validateDiscoveryUrl(discoveryUrl);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input = 'public/staticwebapp.config.json', output = 'dist/staticwebapp.config.json'] = process.argv.slice(2);
  writeFileSync(output, JSON.stringify(renderConfig(JSON.parse(readFileSync(input, 'utf8')), process.env.ENTRA_OIDC_DISCOVERY_URL), null, 2) + '\n');
}