import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
const vendor = resolve(dist, 'vendor');
await mkdir(vendor, { recursive: true });
const packageDist = resolve(root, 'node_modules/@huggingface/transformers/dist');
await cp(resolve(packageDist, 'transformers.min.js'), resolve(vendor, 'transformers.js'));
for (const name of await readdir(packageDist)) {
  if (name.endsWith('.wasm') || /^ort-.*\.mjs$/.test(name)) await cp(resolve(packageDist, name), resolve(vendor, name));
}
await cp(resolve(root, 'node_modules/@huggingface/transformers/LICENSE'), resolve(vendor, 'TRANSFORMERS-LICENSE.txt'));
const names = (await readdir(dist)).filter(name => !['vendor', 'sw.js', 'cache-manifest.js'].includes(name)).sort();
const hash = createHash('sha256');
for (const name of names) hash.update(name).update(await readFile(resolve(dist, name)));
const version = hash.digest('hex').slice(0, 16);
const worker = (await readFile(resolve(root, 'public/sw.js'), 'utf8')).replaceAll('__LYRICS_VERSION__', version);
await writeFile(resolve(dist, 'sw.js'), worker);
await writeFile(resolve(dist, 'cache-manifest.js'), `self.LYRICS_VERSION=${JSON.stringify(version)};\nself.LYRICS_SHELL=${JSON.stringify(['./', ...names.map(name => './' + name)])};\n`);
await writeFile(resolve(dist, 'artifact.json'), JSON.stringify({ application: 'kaada-lyrics', schemaVersion: 1, relativeAssets: true, publicOnly: true }, null, 2));
console.log(`Built portable artifact: ${dist}`);
