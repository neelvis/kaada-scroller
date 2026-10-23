const PENDING_LOGOUT = 'lyrics-v2-pending-logout';

/** One recovery path for startup, sign-in and interrupted sign-out. */
export function createSessionLifecycle({ remote, clearPrivateData, storage = globalThis.localStorage }) {
  async function recoverLogout() {
    if (!storage.getItem(PENDING_LOGOUT)) return false;
    await clearPrivateData();
    try { await remote.session(); await remote.logout(); }
    catch (error) { if (error.status !== 401) throw error; }
    storage.removeItem(PENDING_LOGOUT);
    return true;
  }
  return {
    async restore() {
      try {
        if (await recoverLogout()) return false;
        await remote.session();
        return true;
      } catch { return false; }
    },
    async signIn(password) {
      await recoverLogout();
      return remote.login(password);
    },
    async signOut(onStarted) {
      storage.setItem(PENDING_LOGOUT, '1');
      onStarted();
      let cleared = true, revoked = true;
      try { await clearPrivateData(); } catch { cleared = false; }
      try { await remote.logout(); } catch { revoked = false; }
      if (cleared && revoked) storage.removeItem(PENDING_LOGOUT);
      return { cleared, revoked };
    },
  };
}
