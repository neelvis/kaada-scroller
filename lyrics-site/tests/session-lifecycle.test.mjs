import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLifecycle } from '../public/session-lifecycle.js';

function fixture({ pending = false, clearFails = false, logoutFails = false, sessionStatus = 200 } = {}) {
  const values = new Map(pending ? [['lyrics-v2-pending-logout', '1']] : []), events = [];
  const storage = { getItem:key => values.get(key), setItem:(key, value) => values.set(key, value), removeItem:key => values.delete(key) };
  const remote = {
    async session() { events.push('session'); if (sessionStatus !== 200) throw Object.assign(new Error('session'), { status:sessionStatus }); },
    async logout() { events.push('logout'); if (logoutFails) throw new Error('offline'); },
    async login(password) { events.push(`login:${password}`); },
  };
  const lifecycle = createSessionLifecycle({ remote, storage, clearPrivateData:async () => { events.push('clear'); if (clearFails) throw new Error('disk'); } });
  return { lifecycle, events, pending:() => values.has('lyrics-v2-pending-logout') };
}

test('startup restores a live session without clearing its private audio', async () => {
  const f = fixture(); assert.equal(await f.lifecycle.restore(), true); assert.deepEqual(f.events, ['session']);
});
test('startup and login share interrupted-logout recovery including an expired cookie', async () => {
  for (const sessionStatus of [200, 401]) {
    const startup = fixture({ pending:true, sessionStatus });
    assert.equal(await startup.lifecycle.restore(), false); assert.equal(startup.pending(), false);
    const login = fixture({ pending:true, sessionStatus });
    await login.lifecycle.signIn('password'); assert.equal(login.pending(), false);
    assert.deepEqual(login.events, [...startup.events, 'login:password']);
  }
});
test('failed pending cleanup or revocation prevents a new login and survives reload', async () => {
  for (const failure of [{ clearFails:true }, { logoutFails:true }, { sessionStatus:503 }]) {
    const f = fixture({ pending:true, ...failure });
    await assert.rejects(f.lifecycle.signIn('password'));
    assert.equal(f.pending(), true); assert.ok(!f.events.includes('login:password'));
    assert.equal(await f.lifecycle.restore(), false); assert.equal(f.pending(), true);
  }
});
test('sign-out hides private UI after recording recovery intent and retains failed work', async () => {
  for (const failure of [{}, { clearFails:true }, { logoutFails:true }, { clearFails:true, logoutFails:true }]) {
    const f = fixture(failure);
    const result = await f.lifecycle.signOut(() => { assert.equal(f.pending(), true); f.events.push('hide'); });
    assert.deepEqual(f.events, ['hide', 'clear', 'logout']);
    assert.deepEqual(result, { cleared:!failure.clearFails, revoked:!failure.logoutFails });
    assert.equal(f.pending(), Boolean(failure.clearFails || failure.logoutFails));
  }
});
