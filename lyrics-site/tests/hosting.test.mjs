import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../public/', import.meta.url);
test('public artifact has only relative app assets and no NastyEdu runtime dependency', async () => {
  const html = await readFile(new URL('index.html', publicDir), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    assert.ok(!match[1].startsWith('/'), `root-bound URL ${match[1]}`);
    assert.ok(!match[1].startsWith('http'), `runtime external asset ${match[1]}`);
  }
  assert.ok(!html.includes('/assets/site'));
});
test('service worker scopes caches by own mount and has no broad request interception', async () => {
  const sw = await readFile(new URL('sw.js', publicDir), 'utf8');
  assert.match(sw, /encodeURIComponent\(BASE.pathname\)/);
  assert.match(sw, /SHELL.includes/);
  assert.ok(!sw.includes('skipWaiting'));
});
