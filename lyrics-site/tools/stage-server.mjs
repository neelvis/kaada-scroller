import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = process.argv[2] || new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
if (!/^\d{8}_\d{6}$/.test(releaseId)) throw new Error('Release ID must be YYYYMMDD_HHMMSS (UTC).');
const output = process.argv[3] ? resolve(process.argv[3]) : resolve(root, `../work/timed-lyrics-20261012/staging/kaada-lyrics-${releaseId}`);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await cp(join(root, 'dist'), join(output, 'release'), { recursive: true });
await mkdir(join(output, 'service/backend'), { recursive: true });
const backendNames = (await readdir(join(root, 'backend'), { withFileTypes: true }))
  .filter(entry => entry.isFile() && (entry.name.endsWith('.py') || ['requirements.txt', 'requirements-lock.txt'].includes(entry.name)));
for (const entry of backendNames) await cp(join(root, 'backend', entry.name), join(output, 'service/backend', entry.name));
await cp(join(root, 'backend/runtime-artifacts'), join(output, 'service/runtime'), { recursive: true });
for (const name of ['install-api.py', 'activate-server.py', 'prepare-service.py']) {
  await cp(join(root, 'deploy', name), join(output, name));
}
const manifest = {};
async function walk(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), relative = prefix + '/' + entry.name;
    if (entry.isDirectory()) await walk(path, relative);
    else if (entry.isFile()) manifest[relative] = createHash('sha256').update(await readFile(path)).digest('hex');
    else throw new Error('Release contains a symlink or special file.');
  }
}
await walk(join(output, 'release'), 'release');
await walk(join(output, 'service'), 'service');
await writeFile(join(output, 'SERVER-SHA256.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(output, 'RELEASE_ID'), releaseId + '\n');
console.log(output);
