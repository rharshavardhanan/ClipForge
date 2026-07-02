import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../../utils/logger.js';

const UI_DIR = resolve('ui');

/** Launch the local GUI (Next.js dev server in ui/). Blocks until the server exits. */
export async function runUi(port: number): Promise<void> {
  if (!existsSync(join(UI_DIR, 'package.json'))) {
    throw new Error(`GUI package not found at ${UI_DIR}`);
  }
  if (!existsSync(join(UI_DIR, 'node_modules'))) {
    throw new Error(`GUI dependencies missing — run: cd ui && npm install`);
  }
  if (!existsSync(resolve('dist', 'cli', 'index.js'))) {
    throw new Error('CLI build missing — run: npm run build (the GUI shells out to dist/cli/index.js)');
  }

  logger.info(`Starting ClipForge GUI → http://localhost:${port}`);
  const proc = spawn('npx', ['next', 'dev', '-p', String(port)], {
    cwd: UI_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      // absolutize before handing to the ui/ process — .env may hold relative paths
      REPO_ROOT: resolve('.'),
      WORKSPACE_DIR: resolve(process.env.WORKSPACE_DIR ?? './workspace'),
    },
  });
  await new Promise<void>((res, rej) => {
    proc.on('close', (code) => (code === 0 || code === null ? res() : rej(new Error(`GUI exited with code ${code}`))));
    proc.on('error', rej);
  });
}
