const notFound = () => new DOMException('Missing file', 'NotFoundError');

/** FileSystemDirectoryHandle-shaped memory fixture with failure and pause hooks. */
export function createDirectoryFixture() {
  const files = new Map();
  const directories = new Set(['']);
  const operations = [];
  const control = { fail: null, wait: null };
  async function check(path, phase) {
    operations.push({ path, phase });
    const failure = control.fail?.(path, phase);
    if (failure) throw failure;
    await control.wait?.(path, phase);
  }
  function handle(path = '') {
    return {
      kind: 'directory', name: path.split('/').at(-1) || 'Music',
      async getDirectoryHandle(name, { create = false } = {}) {
        const target = `${path}/${name}`;
        await check(target, 'directory');
        if (!directories.has(target)) { if (!create) throw notFound(); directories.add(target); }
        return handle(target);
      },
      async getFileHandle(name, { create = false } = {}) {
        const target = `${path}/${name}`;
        await check(target, 'file');
        if (!files.has(target)) { if (!create) throw notFound(); files.set(target, new Blob()); }
        return {
          kind: 'file', name,
          async getFile() { await check(target, 'read'); return files.get(target); },
          async createWritable() {
            await check(target, 'writable');
            let pending;
            return {
              async write(blob) { await check(target, 'write'); pending = blob; },
              async close() { await check(target, 'close'); files.set(target, pending); },
              async abort() {},
            };
          },
        };
      },
      async *entries() {
        await check(path, 'entries');
        for (const file of files.keys()) if (file.slice(0, file.lastIndexOf('/')) === path) yield [file.split('/').at(-1), { kind: 'file' }];
      },
    };
  }
  return { handle: handle(), files, directories, operations, control };
}

export function pauseNextSnapshot(fs) {
  let release, arrived;
  const paused = new Promise(resolve => { arrived = resolve; });
  const continuation = new Promise(resolve => { release = resolve; });
  fs.control.wait = async (path, phase) => {
    if (phase === 'close' && path.endsWith('.json') && !path.endsWith('.commit.json')) {
      fs.control.wait = null;
      arrived();
      await continuation;
    }
  };
  return { paused, release };
}
