import { access, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Assembles the standalone bundle the way infra/docker/Dockerfile.web does.
 *
 * `next build` emits .next/standalone without the static assets or public files; the image
 * copies them in afterwards. E2E has to perform the same assembly, otherwise it would serve
 * a bundle no deployment ever runs. Keep this in step with Dockerfile.web.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../web');
const standalone = resolve(web, '.next/standalone/apps/web');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(resolve(standalone, 'server.js')))) {
  throw new Error(
    `Standalone server missing at ${standalone}/server.js. Run \`pnpm --filter @hood-sentry/web build\` first, and confirm next.config.ts still sets output: 'standalone'.`,
  );
}

// Dockerfile.web: COPY .next/static -> apps/web/.next/static, public -> apps/web/public
await cp(resolve(web, '.next/static'), resolve(standalone, '.next/static'), { recursive: true });

if (await exists(resolve(web, 'public'))) {
  await cp(resolve(web, 'public'), resolve(standalone, 'public'), { recursive: true });
}

process.stdout.write(`Staged standalone bundle at ${standalone}\n`);
