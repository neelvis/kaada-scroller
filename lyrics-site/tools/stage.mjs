import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || new Date().toISOString().replace(/[-:]/g, '').replace('T','_').slice(0,15);
if (!/^\d{8}_\d{6}$/.test(id)) throw new Error('Release ID must be YYYYMMDD_HHMMSS (UTC).');
const output = process.argv[3] ? resolve(process.argv[3]) : resolve(root, `../work/timed-lyrics-20261012/staging/kaada-lyrics-${id}`);
await mkdir(dirname(output), {recursive:true});
await mkdir(output); // Existing staging is immutable; never overwrite it.
await cp(join(root,'dist'),join(output,'release'),{recursive:true});
await cp(join(root,'deploy/install-host.py'),join(output,'install-host.py'));
await cp(join(root,'deploy/activate-release.py'),join(output,'activate-release.py'));
const manifest={};
async function walk(base,relative='') {
  for (const entry of await readdir(join(base,relative),{withFileTypes:true})) {
    const name=relative ? relative+'/'+entry.name : entry.name;
    if(entry.isDirectory()) await walk(base,name);
    else if(entry.isFile()) manifest[name]=createHash('sha256').update(await readFile(join(base,name))).digest('hex');
    else throw new Error('Public releases cannot contain symlinks or special files.');
  }
}
await walk(join(output,'release'));
await writeFile(join(output,'SHA256.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(output,'RELEASE_ID'),id+'\n');
console.log(output);
