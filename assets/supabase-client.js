// Smash Pairing - Supabase auth and cross-device sync
//
// Exposes window.SmashSync, used by app.js and (later) the login UI.
//
//   SmashSync.isEnabled()                  -> bool: config filled in?
//   SmashSync.getCurrentUser()             -> { id, username } | null
//   SmashSync.onAuthChange(fn)             -> fn(user|null) on login/logout
//   SmashSync.signUp(username, password)   -> { user } or throws
//   SmashSync.signIn(username, password)   -> { user } or throws
//   SmashSync.signOut()                    -> wipes local app data
//   SmashSync.syncOnLoad()                 -> async, pulls remote and reloads
//                                             page if any remote key was newer
//   SmashSync.pushKey(key, value)          -> debounced upsert (no-op when
//                                             logged out or sync disabled)
//
// Sync model: local-first, last-writer-wins per key.
// - Every push also stamps `${key}__updated_at` in localStorage so the next
//   syncOnLoad can compare timestamps and only pull keys that are stale.
// - When remote is newer, we overwrite local + reload the page so the in-
//   memory state in app.js re-hydrates from localStorage cleanly.

(function () {
  const cfg = window.SMASH_PAIRING_SUPABASE || {};
  const SYNCED_KEYS = ['tp_v2', 'tp_presets', 'tp_profiles', 'tp_schedule_range'];
  const TABLE = 'user_data';
  const PUSH_DEBOUNCE_MS = 1000;
  const TS_SUFFIX = '__updated_at';

  function isConfigured() {
    return !!(cfg.url && cfg.anonKey
      && cfg.url !== 'YOUR_SUPABASE_PROJECT_URL'
      && cfg.anonKey !== 'YOUR_SUPABASE_ANON_KEY'
      && window.supabase && typeof window.supabase.createClient === 'function');
  }

  // No-op shim when sync is disabled - lets app.js call SmashSync.* freely
  // without null-checks. Every method returns the same shape as the real one.
  const disabledShim = {
    isEnabled: () => false,
    ready: Promise.resolve(),
    getCurrentUser: () => null,
    onAuthChange: () => () => {},
    signUp: async () => { throw new Error('Supabase not configured'); },
    signIn: async () => { throw new Error('Supabase not configured'); },
    signOut: async () => {},
    syncOnLoad: async () => false,
    pushKey: () => {},
    pushAllNow: async () => {},
    clearRemote: async () => {},
    pullAll: async () => ({}),
  };

  if (!isConfigured()) {
    window.SmashSync = disabledShim;
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'sb-smash-pairing-auth',
    },
  });

  let currentUser = null;             // { id, username } | null
  const authListeners = new Set();
  const pushTimers = new Map();       // key -> timeout id

  function normalizeUsername(username) {
    const u = String(username || '').trim();
    if (!u) throw new Error('Username required');
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(u)) {
      throw new Error('Username must be 2-32 chars: letters, numbers, . _ -');
    }
    return u;
  }

  function normalizeEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new Error('Enter a valid email address');
    }
    return e;
  }

  function userFromSession(session) {
    if (!session || !session.user) return null;
    const meta = session.user.user_metadata || {};
    return {
      id: session.user.id,
      email: session.user.email || null,
      // Fall back to the email's local-part if metadata is missing (covers
      // any account that pre-dates the username field).
      username: meta.username
        || (session.user.email ? session.user.email.split('@')[0] : null),
    };
  }

  function notifyAuth() {
    for (const fn of authListeners) {
      try { fn(currentUser); } catch (_) {}
    }
  }

  function localTimestamp(key) {
    return localStorage.getItem(key + TS_SUFFIX) || '1970-01-01T00:00:00.000Z';
  }

  function stampLocal(key, iso) {
    localStorage.setItem(key + TS_SUFFIX, iso || new Date().toISOString());
  }

  function clearLocalAppData() {
    for (const k of SYNCED_KEYS) {
      localStorage.removeItem(k);
      localStorage.removeItem(k + TS_SUFFIX);
    }
  }

  async function pullAll() {
    if (!currentUser) return {};
    const { data, error } = await client
      .from(TABLE)
      .select('key, value, updated_at')
      .eq('user_id', currentUser.id);
    if (error) throw error;
    const map = {};
    for (const row of data || []) map[row.key] = row;
    return map;
  }

  async function pushKeyNow(key, value) {
    if (!currentUser) return;
    if (!SYNCED_KEYS.includes(key)) return;
    const payload = {
      user_id: currentUser.id,
      key,
      value: value == null ? null : value,
    };
    const { data, error } = await client
      .from(TABLE)
      .upsert(payload, { onConflict: 'user_id,key' })
      .select('updated_at')
      .single();
    if (error) throw error;
    if (data && data.updated_at) stampLocal(key, data.updated_at);
  }

  function readLocalValue(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }

  function pushKey(key, value) {
    if (!currentUser) return;
    if (!SYNCED_KEYS.includes(key)) return;
    stampLocal(key, new Date().toISOString());
    if (pushTimers.has(key)) clearTimeout(pushTimers.get(key));
    const t = setTimeout(() => {
      pushTimers.delete(key);
      const v = value === undefined ? readLocalValue(key) : value;
      pushKeyNow(key, v).catch(() => {
        // Best-effort. Next save will retry. Offline writes catch up
        // automatically once a future save succeeds.
      });
    }, PUSH_DEBOUNCE_MS);
    pushTimers.set(key, t);
  }

  // Force any pending debounced pushes to flush immediately. Called before
  // sign-out so we don't drop the user's last few keystrokes.
  async function flushPending() {
    const keys = [...pushTimers.keys()];
    for (const key of keys) {
      clearTimeout(pushTimers.get(key));
      pushTimers.delete(key);
      try { await pushKeyNow(key, readLocalValue(key)); } catch (_) {}
    }
  }

  // Push every synced key from current localStorage to remote, bypassing
  // the debounce. Used by Import (so we don't lose pushes during reload)
  // and any other "the local state just changed wholesale" caller.
  async function pushAllNow() {
    if (!currentUser) return;
    for (const key of SYNCED_KEYS) {
      stampLocal(key, new Date().toISOString());
      try { await pushKeyNow(key, readLocalValue(key)); } catch (_) {}
    }
  }

  // Delete every row this user owns. Used by Reset so the user's account
  // matches their wiped local data.
  async function clearRemote() {
    if (!currentUser) return;
    try {
      await client.from(TABLE).delete().eq('user_id', currentUser.id);
    } catch (_) {}
  }

  // Pull, then for every key decide: remote wins / local wins / equal.
  // Returns true if any local key was overwritten (caller should reload).
  async function syncOnLoad() {
    if (!currentUser) return false;
    let remote;
    try { remote = await pullAll(); }
    catch (_) { return false; }

    let localChanged = false;
    let needsPush = [];

    for (const key of SYNCED_KEYS) {
      const r = remote[key];
      const localVal = readLocalValue(key);
      const localTs = localTimestamp(key);
      const remoteTs = r ? r.updated_at : null;

      if (!r && localVal != null) {
        // Remote missing, local has data: push it up (fresh account case).
        needsPush.push(key);
      } else if (r && localVal == null) {
        // Local missing, remote has data: pull it down.
        localStorage.setItem(key, JSON.stringify(r.value));
        stampLocal(key, remoteTs);
        localChanged = true;
      } else if (r && localVal != null) {
        if (remoteTs > localTs) {
          // Remote newer: overwrite local.
          localStorage.setItem(key, JSON.stringify(r.value));
          stampLocal(key, remoteTs);
          localChanged = true;
        } else if (localTs > remoteTs) {
          // Local newer: push.
          needsPush.push(key);
        }
      }
    }

    for (const key of needsPush) {
      try { await pushKeyNow(key, readLocalValue(key)); } catch (_) {}
    }

    return localChanged;
  }

  async function signUp(username, email, password) {
    const u = normalizeUsername(username);
    const e = normalizeEmail(email);
    const { data, error } = await client.auth.signUp({
      email: e,
      password,
      options: { data: { username: u } },
    });
    if (error) throw error;
    if (!data.session) {
      // Email confirmation is enabled in the Supabase project. With a real
      // email this is fine - the user gets a confirmation link - but the app
      // won't have a session until they click it. Surface that clearly.
      throw new Error('Check your email to confirm the account, then sign in.');
    }
    currentUser = userFromSession(data.session);
    notifyAuth();
    return { user: currentUser };
  }

  async function signIn(email, password) {
    const e = normalizeEmail(email);
    console.log('[auth] signIn ->', e);
    const { data, error } = await client.auth.signInWithPassword({ email: e, password });
    console.log('[auth] signIn response', { hasSession: !!(data && data.session), error });
    if (error) throw error;
    if (!data.session) throw new Error('Sign-in returned no session');
    currentUser = userFromSession(data.session);
    notifyAuth();
    return { user: currentUser };
  }

  async function signOut() {
    await flushPending();
    try { await client.auth.signOut(); } catch (_) {}
    currentUser = null;
    clearLocalAppData();
    notifyAuth();
  }

  function getCurrentUser() { return currentUser; }

  function onAuthChange(fn) {
    authListeners.add(fn);
    return () => authListeners.delete(fn);
  }

  // Pick up the existing session (if any) at script load so app.js can see
  // a logged-in user immediately on boot. `ready` resolves once this initial
  // hydration is done - callers should await it before relying on
  // getCurrentUser() at startup.
  const ready = client.auth.getSession().then(({ data }) => {
    currentUser = userFromSession(data.session);
    console.log('[auth] boot session', currentUser);
    notifyAuth();
  }).catch((e) => { console.error('[auth] boot session error', e); });

  // Refresh-token rotations and external sign-outs (e.g. token expired in
  // another tab) flow through here so authListeners stay accurate.
  client.auth.onAuthStateChange((_event, session) => {
    currentUser = userFromSession(session);
    notifyAuth();
  });

  window.SmashSync = {
    isEnabled: () => true,
    ready,
    getCurrentUser,
    onAuthChange,
    signUp,
    signIn,
    signOut,
    syncOnLoad,
    pushKey,
    pushAllNow,
    clearRemote,
    pullAll,
  };
})();
