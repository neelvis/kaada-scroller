import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const output=resolve(process.argv[2] || 'test-results/kaada-lyrics.tar.gz');
await mkdir(resolve(output,'..'),{recursive:true});
const result=spawnSync('tar',['-czf',output,'-C','dist','.'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(`Portable release archive: ${output}`);
