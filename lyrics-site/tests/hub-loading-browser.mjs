import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.HUB_LOADING_PORT || 8279);
const origin = `http://127.0.0.1:${port}`;
const html = `<!doctype html><html><head><link rel="stylesheet" href="/public/hub.css"></head><body>
  <div id="home-view"><h1 id="hub-title"></h1><p id="hub-description"></p>
    <nav><button id="projects">Projects</button><button id="library">Library</button></nav>
    <div class="hub-toolbar"><div class="hub-search-wrap"><input id="hub-search"></div><button id="hub-create"></button></div>
    <div id="hub-list" class="hub-list"></div><p id="hub-message"></p>
  </div><div id="preparation-view" hidden></div>
  <script type="module">
    import { createWorkspaceHub } from '/public/workspace-hub.js';
    const song = { schemaVersion: 1, id: 'song-record', title: 'Cloud song', artist: 'Artist', language: 'en', duration: 20, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'cue-1', start: 0, type: 'lyric', text: 'Line' }] };
    const state = {
      projects: [{ id: 'local-project', name: 'Local project', songs: [{ duration: 20 }] }],
      cloudProjects: [{ id: 'cloud-project', name: 'Cloud project', songCount: 2 }],
      cloudSongs: [{ id: 'cloud-song', title: 'Cloud song', reviewed: true, valid: true, song }],
      links: { 'project:local-project': { id: 'linked-project' } }, session: { id: 'session' }, transfers: new Map(), message: '',
    };
    const calls = window.actionCalls = [];
    window.pendingActions = {};
    const deferred = name => {
      calls.push(name);
      return new Promise((resolve, reject) => { window.pendingActions[name] = { resolve, reject }; });
    };
    const actions = {
      leaveEditor: async () => true, refresh() {}, readiness: async () => 'Ready',
      openProject: id => deferred(\`openProject:\${id}\`), play: id => deferred(\`play:\${id}\`),
      openCloudProject: id => deferred(\`openCloudProject:\${id}\`), playCloudProject: id => deferred(\`playCloudProject:\${id}\`),
      openCloudSong: id => deferred(\`openCloudSong:\${id}\`), playCloudSong: id => deferred(\`playCloudSong:\${id}\`),
      download: (_kind, id) => calls.push(\`download:\${id}\`), removeCloudProject: id => calls.push(\`removeCloudProject:\${id}\`),
      createLibraryCopy: item => calls.push(\`createLibraryCopy:\${item.id}\`), removeCloudSong: id => calls.push(\`removeCloudSong:\${id}\`),
      remove: (kind, id) => calls.push(\`remove:\${kind}:\${id}\`), createProject() {}, createSong() {},
    };
    window.hub = createWorkspaceHub({ state: () => state, actions });
    await window.hub.show('projects');
  </script>
</body></html>`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return; }
    if (pathname === '/public/hub.css') {
      const css = await readFile(resolve(publicRoot, 'hub.css'));
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); response.end(css); return;
    }
    if (pathname.startsWith('/public/')) {
      const file = resolve(publicRoot, pathname.slice('/public/'.length));
      if (!file.startsWith(`${publicRoot}${sep}`)) throw new Error('invalid module path');
      const source = await readFile(file);
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(source); return;
    }
    response.writeHead(404); response.end('not found');
  } catch (error) { response.writeHead(500); response.end(error.message); }
});

let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  await page.waitForTimeout(100);
  if (await page.locator('#hub-list [data-local-id="local-project"]').count() === 0) throw new Error(`hub failed to render; page errors: ${pageErrors.join(' | ')}`);
  await page.locator('#hub-list [data-local-id="local-project"]').waitFor();

  const scenarios = [
    { destination: 'projects', selector: '[data-local-id="local-project"]', first: 'edit', retry: 'edit', action: 'openProject:local-project', fail: 'reject', extras: ['есть локальная копия', 'Удалить проект'] },
    { destination: 'projects', selector: '[data-local-id="local-project"]', first: 'play', retry: 'play', action: 'play:local-project', fail: 'false', extras: ['есть локальная копия', 'Удалить проект'] },
    { destination: 'projects', selector: '[data-cloud-id="cloud-project"]', first: 'edit', retry: 'edit', action: 'openCloudProject:cloud-project', fail: 'false', extras: ['Сохранить локальную копию', 'Удалить проект'] },
    { destination: 'projects', selector: '[data-cloud-id="cloud-project"]', first: 'play', retry: 'play', action: 'playCloudProject:cloud-project', fail: 'reject', extras: ['Сохранить локальную копию', 'Удалить проект'] },
    { destination: 'library', selector: '[data-cloud-id="cloud-song"]', first: 'edit', retry: 'edit', action: 'openCloudSong:cloud-song', fail: 'reject', extras: ['Создать копию', 'Удалить песню'] },
    { destination: 'library', selector: '[data-cloud-id="cloud-song"]', first: 'play', retry: 'play', action: 'playCloudSong:cloud-song', fail: 'false', extras: ['Создать копию', 'Удалить песню'] },
  ];

  const activate = async (card, type) => {
    if (type === 'play') await card.locator('button[aria-label="Запустить"]').click();
    else await card.locator('h2').click();
  };
  for (const scenario of scenarios) {
    await page.evaluate(destination => window.hub.show(destination), scenario.destination);
    const card = page.locator(`#hub-list ${scenario.selector}`);
    await card.waitFor();
    await activate(card, scenario.first);
    await page.waitForTimeout(50);
    if (!(await page.evaluate(name => window.actionCalls.includes(name), scenario.action))) throw new Error(`${scenario.action}: activation did not invoke action; page errors: ${pageErrors.join(' | ')}`);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-busy') === 'true', `#hub-list ${scenario.selector}`);
    assert.equal(await card.evaluate(element => getComputedStyle(element, '::before').animationName), 'hub-spin', `${scenario.action}: spinner is visible while pending`);
    assert.ok(await card.evaluate(element => element.classList.contains('is-opening')));

    // A pending action blocks both repeated activation and the other card activation route.
    if (scenario.first === 'edit') {
      await card.locator('h2').click();
      assert.equal(await card.locator('button[aria-label="Запустить"]').isDisabled(), true, `${scenario.action}: play control is disabled while pending`);
    } else {
      assert.equal(await card.locator('button[aria-label="Запустить"]').isDisabled(), true, `${scenario.action}: repeated play is disabled while pending`);
      await card.locator('h2').click();
    }
    await card.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(name => window.actionCalls.filter(call => call === name).length, scenario.action), 1, `${scenario.action}: duplicate mouse/keyboard activation is guarded`);

    await page.evaluate(() => window.hub.render());
    const rerendered = page.locator(`#hub-list ${scenario.selector}`);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-busy') === 'true', `#hub-list ${scenario.selector}`);
    assert.equal(await rerendered.evaluate(element => getComputedStyle(element, '::before').animationName), 'hub-spin');
    for (const label of scenario.extras) assert.equal(await rerendered.locator(`button[aria-label^="${label}"]`).isDisabled(), false, `${scenario.action}: unrelated ${label} remains enabled`);

    await page.evaluate(({ name, fail }) => {
      const pending = window.pendingActions[name];
      if (fail === 'reject') pending.reject(new Error('expected mocked load failure'));
      else pending.resolve(false);
    }, { name: scenario.action, fail: scenario.fail });
    await rerendered.waitFor({ state: 'attached' });
    await page.waitForFunction(selector => !document.querySelector(selector)?.hasAttribute('aria-busy'), `#hub-list ${scenario.selector}`);
    const afterFailure = page.locator(`#hub-list ${scenario.selector}`);
    assert.equal(await afterFailure.evaluate(element => element.classList.contains('is-opening')), false, `${scenario.action}: failure clears spinner`);

    await activate(afterFailure, scenario.retry);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-busy') === 'true', `#hub-list ${scenario.selector}`);
    assert.equal(await page.evaluate(name => window.actionCalls.filter(call => call === name).length, scenario.action), 2, `${scenario.action}: real retry invokes action again`);
    await page.evaluate(name => window.pendingActions[name].resolve(false), scenario.action);
    await page.waitForFunction(selector => !document.querySelector(selector)?.hasAttribute('aria-busy'), `#hub-list ${scenario.selector}`);
  }

  assert.deepEqual(pageErrors, [], 'isolated browser page has no runtime errors');
  console.log('hub loading browser checks passed (6 deferred edit/play paths, duplicate guard, rerender, unrelated controls, failure cleanup and retry)');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
