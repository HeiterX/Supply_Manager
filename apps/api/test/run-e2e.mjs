import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createE2eEnvironment } from './e2e-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

try {
  const env = createE2eEnvironment(
    readFileSync(new URL('../.env', import.meta.url), 'utf8'),
    readFileSync(new URL('../.env.test', import.meta.url), 'utf8'),
    process.env,
  );
  env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('../.env.test', import.meta.url));
  console.log('E2E: isolated schema=e2e verified before migrations');
  // Resolve local entry points: no Bash/WSL, npx downloads or shell expansion.
  /** @type {Array<[string, string[]]>} */
  const commands = [
    [require.resolve('prisma/build/index.js'), ['migrate', 'deploy']],
    [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
      ['run', '--config', './vitest.config.e2e.ts']],
  ];
  for (const [entry, args] of commands) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: root, env, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} catch {
  // Do not echo connection strings or dotenv contents into public CI logs.
  console.error('E2E refused: check .env/.env.test, explicit PostgreSQL URLs and isolated schema=e2e.');
  process.exitCode = 1;
}
