import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

/** Install a browser File System Access adapter whose file bytes go to a real directory. */
export async function installWorkspaceDirectory(page, directoryPath) {
  const root = resolve(directoryPath);
  async function bridge(operation, parts, encoded = '') {
    const path = resolve(root, ...parts);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Workspace path escaped its root.');
    if (operation === 'mkdir') { await mkdir(path, { recursive: true }); return true; }
    if (operation === 'list') {
      try { return (await readdir(path, { withFileTypes: true })).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })); }
      catch (error) { if (error.code === 'ENOENT') { const missing = new Error('Not found'); missing.name = 'NotFoundError'; throw missing; } throw error; }
    }
    if (operation === 'read') {
      try {
        const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
        return { data: bytes.toString('base64'), lastModified: info.mtimeMs };
      } catch (error) { if (error.code === 'ENOENT') { const missing = new Error('Not found'); missing.name = 'NotFoundError'; throw missing; } throw error; }
    }
    if (operation === 'write') { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, Buffer.from(encoded, 'base64')); return true; }
    throw new Error(`Unknown file bridge operation: ${operation}`);
  }
  await page.exposeFunction('__workspaceFs', bridge);
  await page.addInitScript(({ rootName }) => {
    const childPath = (parent, name) => [...parent.path, name];
    function file(path, name) {
      return {
        kind: 'file', name, path,
        async getFile() {
          const result = await window.__workspaceFs('read', path);
          const raw = atob(result.data), bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
          return new File([bytes], name, { lastModified: result.lastModified });
        },
        async createWritable() {
          let data = '';
          return {
            async write(blob) {
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              data = btoa(binary);
            },
            async close() { await window.__workspaceFs('write', path, data); },
            async abort() {},
          };
        },
      };
    }
    function directory(path) {
      const handle = {
        kind: 'directory', name: path.at(-1) || rootName, path,
        async getDirectoryHandle(name, options = {}) {
          const next = childPath(handle, name);
          if (options.create) await window.__workspaceFs('mkdir', next);
          else await window.__workspaceFs('list', next);
          return directory(next);
        },
        async getFileHandle(name, options = {}) {
          const next = childPath(handle, name);
          if (options.create) await window.__workspaceFs('write', next, '');
          else await window.__workspaceFs('read', next);
          return file(next, name);
        },
        async *entries() {
          for (const entry of await window.__workspaceFs('list', handle.path)) {
            yield [entry.name, entry.kind === 'directory' ? directory(childPath(handle, entry.name)) : file(childPath(handle, entry.name), entry.name)];
          }
        },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; },
      };
      return handle;
    }
    window.showDirectoryPicker = async () => directory([]);
  }, { rootName: basename(root) });
}

export async function connectTestWorkspace(page) {
  await page.locator('#workspace-connect').click();
  await page.waitForFunction(() => Boolean(document.querySelector('#workspace-status')?.textContent.trim()));
}
