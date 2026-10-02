import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('worker/index.js', 'dist/server/index.js');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'price-guide-os', main: 'index.js', compatibility_date: '2026-09-01',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: ['/api/*'] },
}, null, 2));
