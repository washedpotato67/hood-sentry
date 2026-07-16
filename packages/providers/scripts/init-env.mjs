import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const examplePath = path.join(repositoryRoot, '.env.example');
const envPath = path.join(repositoryRoot, '.env');

async function loadEnvironmentFile() {
  try {
    return { contents: await readFile(envPath, 'utf8'), created: false };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { contents: await readFile(examplePath, 'utf8'), created: true };
    }
    throw error;
  }
}

function readValue(lines, key) {
  const prefix = `${key}=`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

function setValue(lines, key, value, overwrite = false) {
  const prefix = `${key}=`;
  const index = lines.findIndex((candidate) => candidate.startsWith(prefix));
  if (index < 0) {
    lines.push(`${key}=${value}`);
    return;
  }
  if (overwrite || lines[index]?.slice(prefix.length).trim() === '') {
    lines[index] = `${key}=${value}`;
  }
}

const environment = await loadEnvironmentFile();
const lines = environment.contents.split(/\r?\n/);
const vapidKeys =
  readValue(lines, 'WEB_PUSH_PUBLIC_KEY') && readValue(lines, 'WEB_PUSH_PRIVATE_KEY')
    ? null
    : webPush.generateVAPIDKeys();

setValue(lines, 'SESSION_SECRET', randomBytes(48).toString('base64url'));
setValue(lines, 'WEBHOOK_SIGNING_SECRET', randomBytes(32).toString('hex'));
if (vapidKeys !== null) {
  setValue(lines, 'WEB_PUSH_PUBLIC_KEY', vapidKeys.publicKey);
  setValue(lines, 'WEB_PUSH_PRIVATE_KEY', vapidKeys.privateKey);
}
if (environment.created) {
  setValue(lines, 'PROJECT_CLAIMS_ENABLED', 'true', true);
  setValue(lines, 'COMMUNITY_REPORTS_ENABLED', 'true', true);
  setValue(lines, 'WEBHOOKS_ENABLED', 'true', true);
}

await writeFile(envPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
await chmod(envPath, 0o600);
process.stdout.write(
  environment.created
    ? 'Created .env with local application secrets. Add provider API keys next.\n'
    : 'Filled missing local application secrets without replacing existing values.\n',
);
