const APP_VERSION = '0.1.0';

// Splash timing is now driven entirely by the CSS animation
// `splash-master` (2500ms). Keeping the duration in sync with the CSS
// is a safety-fallback only - if `animationend` somehow doesn't fire
// (browser bug, tab backgrounded mid-animation), we force-remove the
// splash after SPLASH_FALLBACK_MS so the app never gets stuck behind
// the boot screen.
const SPLASH_FALLBACK_MS = 3000;

// True when the inline head script tagged this load as a repeat-in-session
// (e.g. a service-worker controllerchange reload). The CSS rule
// `html.splash-skip #splash { display: none }` already hid the element;
// we only need to remove it from the DOM and clear the body-bg shift.
const splashSkipped = document.documentElement.classList.contains('splash-skip');

function removeSplash() {
  document.documentElement.classList.remove('splash-showing');
  const splash = document.getElementById('splash');
  if (splash) splash.remove();
}

// Register a network-first service worker so the home-screen PWA
// picks up new deploys automatically instead of running cached files.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./service-worker.js').then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

const state = {
  exp:        [],
  inexp:      [],
  fixedPairs: [],     // [{ id, aName, bName, name? }] — set teams entered by hand
  pairs:      [],     // [{ aId, bId, kind: 'mixed'|'exp'|'inexp', name? }]
  hasPaired:  false,
  mode:       'full', // 'full' = exp+inexp pairs; 'split' = exp+exp and inexp+inexp pairs
  setTeamsExpanded: null, // null = use heuristic (expand if has pairs); true/false = user override
  uid:        0
};

// ---- persistence ----

const STORAGE_KEY = 'tp_v2';
const PRESETS_KEY = 'tp_presets';
const PROFILES_KEY = 'tp_profiles';
const SCHEDULE_RANGE_KEY = 'tp_schedule_range';

// Super Smash Bros. Ultimate fighter roster (87 slots) in canonical
// character-select-screen order. Roster has been frozen since Sora
// (Oct 2021), so we hardcode rather than fetch. id is the storage key
// for profile.main; name is the display label.
const SSBU_FIGHTERS = [
  ['mario', 'Mario'], ['donkey-kong', 'Donkey Kong'], ['link', 'Link'],
  ['samus', 'Samus'], ['dark-samus', 'Dark Samus'], ['yoshi', 'Yoshi'],
  ['kirby', 'Kirby'], ['fox', 'Fox'], ['pikachu', 'Pikachu'],
  ['luigi', 'Luigi'], ['ness', 'Ness'], ['captain-falcon', 'Captain Falcon'],
  ['jigglypuff', 'Jigglypuff'], ['peach', 'Peach'], ['daisy', 'Daisy'],
  ['bowser', 'Bowser'], ['ice-climbers', 'Ice Climbers'], ['sheik', 'Sheik'],
  ['zelda', 'Zelda'], ['dr-mario', 'Dr. Mario'], ['pichu', 'Pichu'],
  ['falco', 'Falco'], ['marth', 'Marth'], ['lucina', 'Lucina'],
  ['young-link', 'Young Link'], ['ganondorf', 'Ganondorf'], ['mewtwo', 'Mewtwo'],
  ['roy', 'Roy'], ['chrom', 'Chrom'], ['mr-game-and-watch', 'Mr. Game & Watch'],
  ['meta-knight', 'Meta Knight'], ['pit', 'Pit'], ['dark-pit', 'Dark Pit'],
  ['zero-suit-samus', 'Zero Suit Samus'], ['wario', 'Wario'], ['snake', 'Snake'],
  ['ike', 'Ike'], ['pokemon-trainer', 'Pokémon Trainer'], ['diddy-kong', 'Diddy Kong'],
  ['lucas', 'Lucas'], ['sonic', 'Sonic'], ['king-dedede', 'King Dedede'],
  ['olimar', 'Olimar'], ['lucario', 'Lucario'], ['rob', 'R.O.B.'],
  ['toon-link', 'Toon Link'], ['wolf', 'Wolf'], ['villager', 'Villager'],
  ['mega-man', 'Mega Man'], ['wii-fit-trainer', 'Wii Fit Trainer'],
  ['rosalina-and-luma', 'Rosalina & Luma'], ['little-mac', 'Little Mac'],
  ['greninja', 'Greninja'], ['mii-brawler', 'Mii Brawler'],
  ['mii-swordfighter', 'Mii Swordfighter'], ['mii-gunner', 'Mii Gunner'],
  ['palutena', 'Palutena'], ['pac-man', 'Pac-Man'], ['robin', 'Robin'],
  ['shulk', 'Shulk'], ['bowser-jr', 'Bowser Jr.'], ['duck-hunt', 'Duck Hunt'],
  ['ryu', 'Ryu'], ['ken', 'Ken'], ['cloud', 'Cloud'], ['corrin', 'Corrin'],
  ['bayonetta', 'Bayonetta'], ['inkling', 'Inkling'], ['ridley', 'Ridley'],
  ['simon', 'Simon'], ['richter', 'Richter'], ['king-k-rool', 'King K. Rool'],
  ['isabelle', 'Isabelle'], ['incineroar', 'Incineroar'],
  ['piranha-plant', 'Piranha Plant'], ['joker', 'Joker'], ['hero', 'Hero'],
  ['banjo-and-kazooie', 'Banjo & Kazooie'], ['terry', 'Terry'], ['byleth', 'Byleth'],
  ['min-min', 'Min Min'], ['steve', 'Steve'], ['sephiroth', 'Sephiroth'],
  ['pyra', 'Pyra'], ['mythra', 'Mythra'], ['kazuya', 'Kazuya'], ['sora', 'Sora'],
].map(([id, name]) => ({ id, name }));

const SSBU_FIGHTERS_BY_ID = Object.fromEntries(SSBU_FIGHTERS.map(f => [f.id, f]));

// Display helper: returns the canonical fighter name for a stored id,
// or falls back to the raw string for legacy free-text mains. Empty
// input returns empty.
function getFighterName(mainValue) {
  if (!mainValue) return '';
  const f = SSBU_FIGHTERS_BY_ID[mainValue];
  return f ? f.name : mainValue;
}

// Used when loading an existing profile into the picker: try to match
// a legacy free-text main (e.g. "mario", "Mario", "DONKEY KONG") to a
// canonical fighter id so the picker shows the right tile as selected.
// Returns '' if no match - the picker shows nothing selected and the
// stored string remains as-is until the user makes a pick.
function findFighterIdByText(text) {
  if (!text) return '';
  if (SSBU_FIGHTERS_BY_ID[text]) return text;
  const norm = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return '';
  for (const f of SSBU_FIGHTERS) {
    if (f.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return f.id;
  }
  return '';
}

let presets = [];
let profiles = [];

// Id of the preset row currently in inline-rename edit mode (null when none).
let editingPresetId = null;

// Profile editing state. currentScreen is NOT persisted - reload always lands
// on Home/Results, never Profiles. editingProfile holds the original snapshot
// for dirty-check; profilesSubview tracks which of the two sub-views is showing.
let currentScreen = 'home';
let editingProfile = null;
let profilesSubview = 'list';

// Scheduling state. None of this is persisted across reloads except for
// scheduleRange (its own localStorage key) - reopening Scheduling always
// lands on the heatmap subview with no profile picked.
let scheduleSubview = 'heatmap';
let currentScheduleProfileId = null;
let editingShift = null;                 // existing shift being edited, or null when adding
let pendingShiftReturnDate = null;       // date the user came from (pre-selects that pill)
let shiftFormSelectedDates = new Set();  // selected date pills, in-memory only
let shiftFormAllDay = false;             // current state of the "unavailable all day" toggle
let scheduleRange = null;                // { startDate, endDate } loaded from storage
let _shiftIdCounter = 0;

// In-progress swap selection on the Results screen. Null when no player is selected.
// Shape: { type: 'exp'|'inexp', pairIdx: number, playerId: number }
let swapSelection = null;

async function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.SmashSync && window.SmashSync.pushKey(STORAGE_KEY, state);
  } catch(e) {
    showToast('Save failed', { variant: 'error' });
  }
}

async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch(e) {}
  if (!Array.isArray(state.fixedPairs)) state.fixedPairs = [];
  if (state.mode !== 'split') state.mode = 'full';
  // Migrate legacy random pairs ({ expId, inexpId } -> { aId, bId, kind: 'mixed' }).
  if (Array.isArray(state.pairs)) {
    state.pairs = state.pairs.map(p => {
      if (p && p.kind) return p;
      if (p && p.expId !== undefined && p.inexpId !== undefined) {
        return { aId: p.expId, bId: p.inexpId, kind: 'mixed', name: p.name };
      }
      return p;
    });
  }
}

function savePresets() {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    window.SmashSync && window.SmashSync.pushKey(PRESETS_KEY, presets);
  } catch(e) {
    showToast('Save failed', { variant: 'error' });
  }
}

function loadPresetsFromStorage() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) presets = JSON.parse(raw);
  } catch(e) {}
}

function saveProfilesToStorage() {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    window.SmashSync && window.SmashSync.pushKey(PROFILES_KEY, profiles);
  } catch(e) {
    showToast('Save failed', { variant: 'error' });
  }
}

function loadProfilesFromStorage() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) profiles = parsed;
  } catch(e) { profiles = []; }
  // Backward-compat: profiles saved before the scheduling feature don't
  // have a shifts array. Default to empty so heatmap math treats them as
  // "always free."
  let mutated = false;
  for (const p of profiles) {
    if (!Array.isArray(p.shifts)) { p.shifts = []; mutated = true; }
    // Best-slot ranking weights profiles by their `attendance` value.
    // Older profiles saved before this field existed get the middle
    // default so they neither pull slots up nor sink them.
    if (typeof p.attendance !== 'number') { p.attendance = 5; mutated = true; }
  }
  // Past-shift purge: drop any shift whose date is strictly before today.
  // Keeps storage small and stops yesterday's work-shifts from skewing
  // tomorrow's heatmap if the user forgets to clean up.
  const today = todayIso();
  for (const p of profiles) {
    const before = p.shifts.length;
    p.shifts = p.shifts.filter(s => s && typeof s.date === 'string' && s.date >= today);
    if (p.shifts.length !== before) mutated = true;
  }
  if (mutated) saveProfilesToStorage();
}

function getProfileById(id) { return profiles.find(p => p.id === id); }
function getProfilesSorted() { return [...profiles].reverse(); }

// ---- helpers ----

function nextId()   { return state.uid++; }

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function unpairedExp() {
  const used = new Set();
  state.pairs.forEach(p => {
    if (p.kind === 'mixed') used.add(p.aId);          // aId is the exp slot in mixed pairs
    else if (p.kind === 'exp') { used.add(p.aId); used.add(p.bId); }
  });
  return state.exp.filter(p => !used.has(p.id));
}

function unpairedInexp() {
  const used = new Set();
  state.pairs.forEach(p => {
    if (p.kind === 'mixed') used.add(p.bId);          // bId is the inexp slot in mixed pairs
    else if (p.kind === 'inexp') { used.add(p.aId); used.add(p.bId); }
  });
  return state.inexp.filter(p => !used.has(p.id));
}

// ---- actions ----

function addPlayer(type, inputId) {
  const input = document.getElementById(inputId || (type + '-input'));
  const name  = input.value.trim();
  if (!name) return;
  state[type].push({ id: nextId(), name });
  input.value = '';
  input.focus();
  saveState();
  render();
}

function pairUnpaired() {
  if (!state.hasPaired) return;
  let added = 0;

  if (state.mode === 'split') {
    const sExp = shuffle(unpairedExp());
    for (let i = 0; i + 1 < sExp.length; i += 2) {
      state.pairs.push({ aId: sExp[i].id, bId: sExp[i + 1].id, kind: 'exp' });
      added++;
    }
    const sInexp = shuffle(unpairedInexp());
    for (let i = 0; i + 1 < sInexp.length; i += 2) {
      state.pairs.push({ aId: sInexp[i].id, bId: sInexp[i + 1].id, kind: 'inexp' });
      added++;
    }
  } else {
    const sExp   = shuffle(unpairedExp());
    const sInexp = shuffle(unpairedInexp());
    const count  = Math.min(sExp.length, sInexp.length);
    for (let i = 0; i < count; i++) {
      state.pairs.push({ aId: sExp[i].id, bId: sInexp[i].id, kind: 'mixed' });
      added++;
    }
  }

  if (!added) return;
  swapSelection = null;
  saveState();
  render();
}

function removePlayer(type, id) {
  state[type] = state[type].filter(p => p.id !== id);
  saveState();
  render();
}

function addFixedPair() {
  const aInput = document.getElementById('fp-a');
  const bInput = document.getElementById('fp-b');
  const a = aInput.value.trim();
  const b = bInput.value.trim();
  if (!a && !b) return;
  if (!a) { aInput.focus(); return; }
  if (!b) { bInput.focus(); return; }
  state.fixedPairs.push({ id: nextId(), aName: a, bName: b });
  aInput.value = '';
  bInput.value = '';
  aInput.focus();
  saveState();
  render();
}

function removeFixedPair(id) {
  state.fixedPairs = state.fixedPairs.filter(fp => fp.id !== id);
  saveState();
  render();
}

function renameFixedPairPlayer(id, slot, value) {
  const fp = state.fixedPairs.find(f => f.id === id);
  if (!fp) return;
  const name = value.trim();
  const key  = slot === 'a' ? 'aName' : 'bName';
  if (!name) { render(); return; }
  if (name === fp[key]) return;
  fp[key] = name;
  saveState();
}

function setFixedTeamName(id, value) {
  const fp = state.fixedPairs.find(f => f.id === id);
  if (!fp) return;
  const name = value.trim();
  if (name) fp.name = name;
  else delete fp.name;
  saveState();
}

function setTeamName(idx, value) {
  const pair = state.pairs[idx];
  if (!pair) return;
  const name = value.trim();
  if (name) pair.name = name;
  else delete pair.name;
  saveState();
}

function renamePlayer(type, id, value) {
  const player = state[type].find(p => p.id === id);
  if (!player) return;
  const name = value.trim();
  if (!name) { render(); return; }
  if (name === player.name) return;
  player.name = name;
  saveState();
}

// Tap a player on the Results screen to start a swap, then tap another player
// of the same category AND in a pair of the same kind to complete the swap.
// Tapping the same player cancels. Tapping a player from an incompatible pair
// (different category or different pair kind, e.g. mixed vs exp-only) moves
// the selection to the new player instead of swapping.
function selectForSwap(category, pairIdx, playerId) {
  if (!state.hasPaired) return;
  const pair = state.pairs[pairIdx];
  if (!pair) return;
  const sel = swapSelection;

  if (sel && sel.playerId === playerId) {
    swapSelection = null;
    renderResults();
    return;
  }

  if (!sel || sel.category !== category || sel.pairKind !== pair.kind) {
    swapSelection = { category, pairKind: pair.kind, pairIdx, playerId };
    renderResults();
    return;
  }

  const other = state.pairs[sel.pairIdx];
  if (!other || sel.pairIdx === pairIdx) {
    swapSelection = null;
    renderResults();
    return;
  }
  // Find which slot (aId / bId) holds each player, then exchange those slots.
  const selSlot    = other.aId === sel.playerId ? 'aId' : 'bId';
  const targetSlot = pair.aId  === playerId      ? 'aId' : 'bId';
  const tmp = other[selSlot];
  other[selSlot] = pair[targetSlot];
  pair[targetSlot] = tmp;

  swapSelection = null;
  saveState();
  renderResults();
}

function setMode(mode) {
  if (mode !== 'full' && mode !== 'split') return;
  if (state.mode === mode) return;
  if (state.hasPaired) return; // menu button is hidden while paired anyway
  state.mode = mode;
  saveState();
  renderMenu();
  renderGenBtn();
}

// Resolve the Set Teams panel's expanded state.
// Once the user explicitly toggles, that choice persists forever.
// Until then, the panel expands by default if pairs already exist (the user
// has invested in the feature) and collapses by default if empty.
function isSetTeamsExpanded() {
  if (state.setTeamsExpanded === true || state.setTeamsExpanded === false) {
    return state.setTeamsExpanded;
  }
  return state.fixedPairs.length > 0;
}

function toggleSetTeams() {
  state.setTeamsExpanded = !isSetTeamsExpanded();
  saveState();
  renderSetTeamsHeader();
}

function generatePairs() {
  if (state.hasPaired) return;
  const hasFixed = state.fixedPairs.length > 0;
  const pairs    = [];

  if (state.mode === 'split') {
    // Pair experienced with experienced and inexperienced with inexperienced
    // separately. Odd counts leave a leftover in the matching unpaired bucket.
    if (state.exp.length >= 2) {
      const sExp = shuffle(state.exp);
      for (let i = 0; i + 1 < sExp.length; i += 2) {
        pairs.push({ aId: sExp[i].id, bId: sExp[i + 1].id, kind: 'exp' });
      }
    }
    if (state.inexp.length >= 2) {
      const sInexp = shuffle(state.inexp);
      for (let i = 0; i + 1 < sInexp.length; i += 2) {
        pairs.push({ aId: sInexp[i].id, bId: sInexp[i + 1].id, kind: 'inexp' });
      }
    }
    if (!hasFixed && pairs.length === 0) return;
  } else {
    // Full 2v2: pair experienced with inexperienced across categories.
    const hasRandom = state.exp.length > 0 && state.inexp.length > 0;
    if (!hasFixed && !hasRandom) return;
    if (hasRandom) {
      const sExp   = shuffle(state.exp);
      const sInexp = shuffle(state.inexp);
      const count  = Math.min(sExp.length, sInexp.length);
      for (let i = 0; i < count; i++) {
        pairs.push({ aId: sExp[i].id, bId: sInexp[i].id, kind: 'mixed' });
      }
    }
  }

  state.pairs     = pairs;
  state.hasPaired = true;
  saveState();
  render();
  fireConfetti();
}

// One-shot celebratory confetti burst on Generate. Lightweight CSS-only
// particles: ~40 small absolutely-positioned divs drop from above the
// viewport with randomized x position, horizontal drift, rotation, size
// and duration so the burst feels chaotic rather than rigid. The container
// is removed from the DOM ~2.5s after creation. Skips entirely under
// prefers-reduced-motion.
const CONFETTI_COLORS = ['#e8442e', '#ffc94d', '#4d9fff', '#2ee8a0', '#fffcef'];

function fireConfetti() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const container = document.createElement('div');
  container.className = 'confetti-burst';
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.setProperty('--c',        CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    piece.style.setProperty('--x',        (Math.random() * 100).toFixed(2) + 'vw');
    piece.style.setProperty('--dx',       ((Math.random() - 0.5) * 200).toFixed(0) + 'px');
    piece.style.setProperty('--rot',      Math.floor(Math.random() * 720) + 'deg');
    piece.style.setProperty('--size',     (4 + Math.random() * 6).toFixed(1) + 'px');
    piece.style.setProperty('--delay',    (Math.random() * 0.3).toFixed(2) + 's');
    piece.style.setProperty('--duration', (1.2 + Math.random() * 0.6).toFixed(2) + 's');
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 2500);
}

// Confetti is z-index 50, modals 100 — but the 70% backdrop leaves the
// dimmed pieces visible drifting behind the sheet. Strip on modal open.
function closeAmbientAnimations() {
  document.querySelectorAll('.confetti-burst').forEach(el => el.remove());
}

// Two-tap reset. First tap arms the button (red styling + "Tap again to confirm").
// A second tap within 3s clears pairings and team names. Players stay in their lists.
let resetArmTimer = null;

function disarmReset() {
  const btn = document.getElementById('btn-back');
  if (!btn) return;
  btn.classList.remove('armed');
  btn.textContent = 'Reset Teams';
  clearTimeout(resetArmTimer);
  resetArmTimer = null;
}

function resetTeams() {
  const btn = document.getElementById('btn-back');
  if (btn.classList.contains('armed')) {
    closeAmbientAnimations();
    disarmReset();
    swapSelection  = null;
    state.pairs     = [];
    state.hasPaired = false;
    saveState();
    render();
    return;
  }
  btn.classList.add('armed');
  btn.textContent = 'Tap again to confirm';
  clearTimeout(resetArmTimer);
  resetArmTimer = setTimeout(disarmReset, 3000);
}

// ---- render ----

// Pluralize a count for the stats line. Returns "1 player" / "5 players".
function _heroPlural(n, singular) {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

// Updates the hero panel's headline + stats line. Idempotent and cheap;
// safe to call on every render(). The hero is hidden by CSS when
// the home screen isn't visible (#home is display:none), so we don't
// need to gate this call by currentScreen.
function renderHero() {
  const headline = document.getElementById('home-hero-headline');
  const stats    = document.getElementById('home-hero-stats');
  if (!headline || !stats) return;

  // Headline: greet the logged-in user when sync is enabled and we know
  // them, otherwise a generic welcome. Falls back through username ->
  // email local-part -> 'Smash Pairing'.
  const user = (window.SmashSync && window.SmashSync.getCurrentUser)
    ? window.SmashSync.getCurrentUser()
    : null;
  const name = user && (user.username || (user.email ? user.email.split('@')[0] : null));
  headline.textContent = name
    ? `Welcome back, @${name}`
    : 'Welcome to Smash Pairing';

  // Stats: live counts from in-memory state. Fresh-account empty case
  // gets an onboarding nudge instead of "0 players · 0 presets · 0 profiles".
  const playerCount  = state.exp.length + state.inexp.length;
  const presetCount  = Array.isArray(presets)  ? presets.length  : 0;
  const profileCount = Array.isArray(profiles) ? profiles.length : 0;

  if (playerCount === 0 && presetCount === 0 && profileCount === 0) {
    stats.textContent = 'Add some players to get started';
  } else {
    stats.innerHTML =
      `<strong>${playerCount}</strong> ${playerCount === 1 ? 'player' : 'players'} ` +
      `&middot; <strong>${presetCount}</strong> ${presetCount === 1 ? 'preset' : 'presets'} ` +
      `&middot; <strong>${profileCount}</strong> ${profileCount === 1 ? 'profile' : 'profiles'}`;
  }

  // First-load entrance plays once per page session. Clear the marker as
  // soon as the hero has been rendered, then drop the class one frame
  // later so the animation has the full opportunity to register. This
  // prevents replays when the user returns to home from Profiles/Schedule.
  if (document.documentElement.classList.contains('is-first-load')
      && sessionStorage.getItem('tp_hero_animated') !== '1') {
    sessionStorage.setItem('tp_hero_animated', '1');
    // Defer class removal so the CSS has caught the animation start.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('is-first-load');
    }));
  }
}

function render() {
  document.getElementById('home').style.display     = state.hasPaired ? 'none' : 'block';
  document.getElementById('menu-btn').style.display = state.hasPaired ? 'none' : 'flex';
  document.body.dataset.screen =
    currentScreen === 'profiles' ? 'profiles' :
    currentScreen === 'schedule' ? 'schedule' :
    (state.hasPaired ? 'results' : 'home');
  renderHero();
  renderMenu();
  renderPanel('exp');
  renderPanel('inexp');
  renderFixedList();
  renderGenBtn();
  renderResults();
}

function renderSetTeamsHeader() {
  const panel  = document.getElementById('set-teams-panel');
  const toggle = document.getElementById('set-teams-toggle');
  if (!panel || !toggle) return;
  const expanded = isSetTeamsExpanded();
  const hasPairs = state.fixedPairs.length > 0;
  panel.classList.toggle('collapsed', !expanded);
  panel.classList.toggle('has-pairs', hasPairs);
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function renderFixedList() {
  document.getElementById('fixed-count').textContent = state.fixedPairs.length;
  renderSetTeamsHeader();
  const list = document.getElementById('fixed-list');
  if (!state.fixedPairs.length) {
    list.innerHTML = '<div class="list-empty">Empty</div>';
    return;
  }
  list.innerHTML = state.fixedPairs.map(fp => `
    <div class="fixed-pair-row">
      <input class="name-edit" type="text" maxlength="40" value="${esc(fp.aName)}"
             autocomplete="off" autocorrect="off" spellcheck="false"
             onchange="renameFixedPairPlayer(${fp.id}, 'a', this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
      <span class="fp-amp">&amp;</span>
      <input class="name-edit" type="text" maxlength="40" value="${esc(fp.bName)}"
             autocomplete="off" autocorrect="off" spellcheck="false"
             onchange="renameFixedPairPlayer(${fp.id}, 'b', this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
      <button class="btn-remove" onclick="removeFixedPair(${fp.id})">×</button>
    </div>
  `).join('');
}

function renderPanel(type) {
  const players = state[type];
  document.getElementById(type + '-count').textContent = players.length;
  const list = document.getElementById(type + '-list');

  if (!players.length) {
    list.innerHTML = '<div class="list-empty">Empty</div>';
    return;
  }

  list.innerHTML = players.map(p => `
    <div class="name-tag">
      ${!state.hasPaired
        ? `<input class="name-edit" type="text" maxlength="40" value="${esc(p.name)}"
                  autocomplete="off" autocorrect="off" spellcheck="false"
                  onchange="renamePlayer('${type}', ${p.id}, this.value)"
                  onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
           <button class="btn-remove" onclick="removePlayer('${type}', ${p.id})">×</button>`
        : `<span>${esc(p.name)}</span>`}
    </div>
  `).join('');
}

function renderGenBtn() {
  const btn      = document.getElementById('btn-generate');
  const hasFixed = state.fixedPairs.length > 0;
  let hasRandom;
  if (state.mode === 'split') {
    hasRandom = state.exp.length >= 2 || state.inexp.length >= 2;
  } else {
    hasRandom = state.exp.length > 0 && state.inexp.length > 0;
  }
  const ready     = hasFixed || hasRandom;
  btn.className   = ready ? 'btn-generate active' : 'btn-generate';
  btn.textContent = 'Generate Teams';
}

function renderMenu() {
  const fullBtn  = document.getElementById('menu-mode-full');
  const splitBtn = document.getElementById('menu-mode-split');
  if (!fullBtn || !splitBtn) return;
  const isFull  = state.mode === 'full';
  const isSplit = state.mode === 'split';
  fullBtn.classList.toggle('active',  isFull);
  splitBtn.classList.toggle('active', isSplit);
  fullBtn.setAttribute('aria-checked',  isFull  ? 'true' : 'false');
  splitBtn.setAttribute('aria-checked', isSplit ? 'true' : 'false');
  const desc = document.getElementById('menu-team-creation-desc');
  if (desc) {
    desc.textContent = isFull  ? 'Currently: Full 2v2'
                     : isSplit ? 'Currently: Split 2v2'
                               : 'Choose a pairing mode';
  }
}

let currentMenuView = 'main';

function openMenu() {
  if (state.hasPaired) return; // safety: menu-btn is hidden in this state anyway
  closeAmbientAnimations();
  const sheet = document.querySelector('#menu-modal .modal-sheet.is-drawer');
  if (sheet) {
    sheet.dataset.view = 'main';
    sheet.dataset.navDirection = 'forward';
  }
  currentMenuView = 'main';
  renderMenu();
  document.getElementById('menu-modal').classList.add('open');
  triggerEnterAnimation('main');
}

function hideMenu() {
  document.getElementById('menu-modal').classList.remove('open');
}

function openSubView(name) {
  const sheet = document.querySelector('#menu-modal .modal-sheet.is-drawer');
  if (!sheet) return;
  currentMenuView = name;
  sheet.dataset.navDirection = 'forward';
  sheet.dataset.view = name;
  triggerEnterAnimation(name);
}

function goBackToMain() {
  const sheet = document.querySelector('#menu-modal .modal-sheet.is-drawer');
  if (!sheet) return;
  currentMenuView = 'main';
  sheet.dataset.navDirection = 'back';
  sheet.dataset.view = 'main';
  triggerEnterAnimation('main');
}

// Force the stagger animation to replay on a view becoming active. CSS
// animations only fire when an element starts matching the selector, so
// repeated entries need the class remove → reflow → re-add pattern.
function triggerEnterAnimation(name) {
  const view = document.querySelector(`#menu-modal .drawer-view-${name}`);
  if (!view) return;
  view.classList.remove('is-entering');
  void view.offsetWidth;
  view.classList.add('is-entering');
}

// Hamburger button calls this so the morphed × can also close the drawer.
function toggleMenu() {
  if (document.getElementById('menu-modal').classList.contains('open')) {
    hideMenu();
  } else {
    openMenu();
  }
}

function handleMenuBackdropClick(e) {
  if (e.target === document.getElementById('menu-modal')) hideMenu();
}

// ---- Profiles screen ----

function openProfilesScreen() {
  closeAmbientAnimations();
  hideMenu();
  currentScreen = 'profiles';
  editingProfile = null;
  setProfilesSubview('list');
  renderProfilesList();
  render();
}

function closeProfilesScreen() {
  currentScreen = 'home';
  render();
}

function goBackInProfiles() {
  if (profilesSubview === 'main-picker') {
    // Picker only mutates main via pickMain(); plain back = no change.
    setProfilesSubview('form');
    return;
  }
  if (profilesSubview === 'form') {
    if (isProfileFormDirty()) {
      showConfirm({
        title: 'Discard changes?',
        body: 'Your unsaved changes will be lost.',
        danger: true,
        confirmLabel: 'Discard'
      }).then(ok => { if (ok) setProfilesSubview('list'); });
    } else {
      setProfilesSubview('list');
    }
  } else {
    closeProfilesScreen();
  }
}

function setProfilesSubview(name) {
  profilesSubview = name;
  const vp = document.querySelector('.profiles-viewport');
  if (vp) vp.dataset.subview = name;
  document.body.dataset.profilesSubview = name;
}

function openAddProfileForm() {
  editingProfile = null;
  document.getElementById('profile-name').value = '';
  document.getElementById('profile-main').value = '';
  updateMainTriggerLabel();
  document.getElementById('profile-notes').value = '';
  setProfileFormSkill('exp');
  setProfileFormAttendance(5);
  document.getElementById('profile-delete-btn').hidden = true;
  setProfilesSubview('form');
  setTimeout(() => document.getElementById('profile-name').focus(), 280);
}

function openEditProfileForm(id) {
  const p = getProfileById(id);
  if (!p) return;
  editingProfile = { ...p };
  document.getElementById('profile-name').value = p.name;
  document.getElementById('profile-main').value = p.main || '';
  updateMainTriggerLabel();
  document.getElementById('profile-notes').value = p.notes || '';
  setProfileFormSkill(p.skill);
  setProfileFormAttendance(typeof p.attendance === 'number' ? p.attendance : 5);
  document.getElementById('profile-delete-btn').hidden = false;
  setProfilesSubview('form');
}

function setProfileFormAttendance(value) {
  const input = document.getElementById('profile-attendance');
  const out   = document.getElementById('profile-attendance-out');
  if (input) input.value = String(value);
  if (out)   out.textContent = String(value);
}

function getProfileFormAttendance() {
  const input = document.getElementById('profile-attendance');
  if (!input) return 5;
  const n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(0, n));
}

function setProfileFormSkill(skill) {
  document.querySelectorAll('.skill-seg-btn').forEach(b => {
    const matches = b.classList.contains(`skill-seg-${skill}`);
    b.setAttribute('aria-checked', matches ? 'true' : 'false');
  });
}

function getProfileFormSkill() {
  const btn = document.querySelector('.skill-seg-btn[aria-checked="true"]');
  return btn && btn.classList.contains('skill-seg-inexp') ? 'inexp' : 'exp';
}

function saveProfileForm() {
  const name       = document.getElementById('profile-name').value.trim();
  const main       = document.getElementById('profile-main').value.trim();
  const notes      = document.getElementById('profile-notes').value.trim();
  const skill      = getProfileFormSkill();
  const attendance = getProfileFormAttendance();
  if (!name) {
    showToast('Name required');
    document.getElementById('profile-name').focus();
    return;
  }
  if (editingProfile) {
    const idx = profiles.findIndex(p => p.id === editingProfile.id);
    if (idx >= 0) profiles[idx] = { ...profiles[idx], name, skill, main, notes, attendance };
  } else {
    profiles.push({ id: Date.now(), name, skill, main, notes, attendance, createdAt: Date.now() });
  }
  saveProfilesToStorage();
  renderProfilesList();
  setProfilesSubview('list');
  editingProfile = null;
}

async function deleteCurrentProfile() {
  if (!editingProfile) return;
  const name = editingProfile.name;
  const ok = await showConfirm({
    title: 'Delete profile?',
    body: `"${name}" will be removed permanently.`,
    danger: true,
    confirmLabel: 'Delete'
  });
  if (!ok) return;
  profiles = profiles.filter(p => p.id !== editingProfile.id);
  saveProfilesToStorage();
  renderProfilesList();
  setProfilesSubview('list');
  editingProfile = null;
}

function isProfileFormDirty() {
  const name       = document.getElementById('profile-name').value.trim();
  const main       = document.getElementById('profile-main').value.trim();
  const notes      = document.getElementById('profile-notes').value.trim();
  const skill      = getProfileFormSkill();
  const attendance = getProfileFormAttendance();
  if (editingProfile) {
    const origAttendance = typeof editingProfile.attendance === 'number' ? editingProfile.attendance : 5;
    return name       !== editingProfile.name ||
           main       !== (editingProfile.main  || '') ||
           notes      !== (editingProfile.notes || '') ||
           skill      !== editingProfile.skill ||
           attendance !== origAttendance;
  }
  return Boolean(name || main || notes) || skill !== 'exp' || attendance !== 5;
}

function renderProfileStats() {
  let exp = 0, inexp = 0;
  for (const p of profiles) {
    if (p.skill === 'exp') exp++;
    else if (p.skill === 'inexp') inexp++;
  }
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('profile-stat-exp', exp);
  set('profile-stat-inexp', inexp);
  set('profile-stat-total', profiles.length);
}

function renderProfilesList() {
  renderProfileStats();
  const container = document.getElementById('profiles-list');
  if (!container) return;
  const sorted = getProfilesSorted();
  if (!sorted.length) {
    container.innerHTML = '<div class="list-empty">No profiles yet. Tap + to add your first one.</div>';
    return;
  }
  container.innerHTML = sorted.map(p => {
    const fid = findFighterIdByText(p.main);
    const avatar = fid
      ? `<span class="profile-avatar profile-avatar-icon ${p.skill}"><img src="assets/fighters/${fid}.webp" alt="" loading="lazy"></span>`
      : `<span class="profile-avatar ${p.skill}">${esc(p.name.charAt(0).toUpperCase())}</span>`;
    return `
      <button class="profile-card" onclick="openEditProfileForm(${p.id})">
        ${avatar}
        <span class="profile-info">
          <span class="profile-name">${esc(p.name)}</span>
          <span class="profile-skill-chip ${p.skill}">${p.skill === 'exp' ? 'Experienced' : 'Inexperienced'}</span>
          ${p.main ? `<span class="profile-main">Main: ${esc(getFighterName(p.main))}</span>` : ''}
        </span>
      </button>
    `;
  }).join('');
}

// ---- Main-character picker (Profiles form sub-view) ----

function openMainPicker() {
  setProfilesSubview('main-picker');
  renderMainPicker();
  // Clear any leftover search query but don't auto-focus - on iOS that
  // would pop the keyboard before the user can see the roster grid.
  const search = document.getElementById('main-picker-search');
  if (search) search.value = '';
  const empty = document.getElementById('main-picker-empty');
  if (empty) empty.hidden = true;
}

function renderMainPicker() {
  const grid = document.getElementById('main-picker-grid');
  if (!grid) return;
  const current = document.getElementById('profile-main').value;
  const currentId = findFighterIdByText(current);
  const noMainSelected = !current;
  const tiles = [
    `<button type="button" class="main-tile main-tile-clear${noMainSelected ? ' is-selected' : ''}" onclick="pickMain('')">No main</button>`,
    ...SSBU_FIGHTERS.map(f => `
      <button type="button" class="main-tile${currentId === f.id ? ' is-selected' : ''}" data-fighter-name="${esc(f.name.toLowerCase())}" onclick="pickMain('${f.id}')">
        <img class="main-tile-icon" src="assets/fighters/${f.id}.webp" alt="" loading="lazy">
        <span class="main-tile-name">${esc(f.name)}</span>
      </button>
    `).join(''),
  ];
  grid.innerHTML = tiles.join('');
}

function filterMainPicker() {
  const q = document.getElementById('main-picker-search').value.trim().toLowerCase();
  const tiles = document.querySelectorAll('#main-picker-grid .main-tile');
  let visible = 0;
  tiles.forEach(t => {
    if (t.classList.contains('main-tile-clear')) {
      // Hide "No main" while searching - search is for finding a fighter.
      t.hidden = q.length > 0;
      if (!t.hidden) visible++;
      return;
    }
    const name = t.dataset.fighterName || '';
    t.hidden = q ? !name.includes(q) : false;
    if (!t.hidden) visible++;
  });
  const empty = document.getElementById('main-picker-empty');
  if (empty) empty.hidden = visible > 0;
}

function pickMain(id) {
  document.getElementById('profile-main').value = id;
  updateMainTriggerLabel();
  setProfilesSubview('form');
}

function updateMainTriggerLabel() {
  const display = document.getElementById('profile-main-display');
  if (!display) return;
  const value = document.getElementById('profile-main').value;
  const label = value ? getFighterName(value) : '';
  display.textContent = label || 'No main';
  display.classList.toggle('is-placeholder', !label);
}

// ---- Scheduling screen ----
//
// Each profile owns a list of busy-time "shifts" on specific upcoming dates.
// The heatmap counts profiles NOT busy in each (date, hour) cell, so the
// best gaming windows pop visually. Profiles with no shifts are treated as
// always-free, which is the right default for a "tell me when you're busy"
// model. Cross-midnight shifts are auto-split into two consecutive-date
// shifts at save time so storage never has wrap-around.

// Local-date helper: standard toISOString uses UTC and can shift the date
// by a day at midnight in non-UTC timezones. This returns YYYY-MM-DD in
// the device's local timezone, which is what the user actually means.
function todayIso() { return toLocalIso(new Date()); }

function toLocalIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toLocalIso(dt);
}

function nextDate(iso) { return addDaysIso(iso, 1); }

function parseIsoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nextShiftId() {
  const now = Date.now();
  if (now <= _shiftIdCounter) _shiftIdCounter++;
  else _shiftIdCounter = now;
  return _shiftIdCounter;
}

function loadScheduleRange() {
  const defaults = { startDate: todayIso(), endDate: addDaysIso(todayIso(), 14) };
  try {
    const raw = localStorage.getItem(SCHEDULE_RANGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.startDate === 'string' && typeof parsed.endDate === 'string'
        && parsed.endDate >= parsed.startDate) {
      return parsed;
    }
  } catch(e) {}
  return defaults;
}

function saveScheduleRange() {
  try {
    localStorage.setItem(SCHEDULE_RANGE_KEY, JSON.stringify(scheduleRange));
    window.SmashSync && window.SmashSync.pushKey(SCHEDULE_RANGE_KEY, scheduleRange);
  } catch(e) { /* storage full / private mode - non-fatal, range falls back to defaults next load */ }
}

function datesInRange() {
  if (!scheduleRange) return [];
  const out = [];
  let cur = scheduleRange.startDate;
  const end = scheduleRange.endDate;
  // Hard cap at 90 dates: protects layout/perf if the user pastes a huge
  // range. They can still get a 3-month view but not, say, all of 2026.
  for (let i = 0; i < 90 && cur <= end; i++) {
    out.push(cur);
    cur = nextDate(cur);
  }
  return out;
}

// ---- Shift CRUD ----

function isProfileBusy(profile, date, hour) {
  if (!profile || !Array.isArray(profile.shifts)) return false;
  return profile.shifts.some(s =>
    s.date === date && hour >= s.startHour && hour < s.endHour
  );
}

function freeCount(date, hour) {
  return profiles.reduce((n, p) => n + (isProfileBusy(p, date, hour) ? 0 : 1), 0);
}

function freeBucket(free, total) {
  if (total === 0) return 4;       // no profiles = nothing's busy, treat as "all free"
  if (free === 0)  return 0;
  const f = free / total;
  if (f === 1)    return 4;
  if (f >= 0.75)  return 3;
  if (f >= 0.5)   return 2;
  return 1;
}

// Heatmap shows the daytime/evening band only - midnight-through-morning
// columns add a lot of vertical scroll for hours nobody schedules. 9 AM
// through 11 PM (inclusive) covers the realistic range.
const HEATMAP_HOUR_START = 9;
const HEATMAP_HOUR_END   = 23;

// Best-slot ranking treats every candidate (date, hour) as the START of a
// 4-hour block (tournaments run ~3-4 hours). A profile counts toward a
// block's score only if they are free for EVERY hour in the block - no
// mid-tournament leavers - and contributes their own `attendance` (0-10,
// default 5) so frequent attendees pull a slot up the rankings.
//
// Two extra rules keep the picks practically useful:
//  - One slot per day: the top N recommendations are on N distinct dates,
//    so we never surface "Sat 3 PM, Sat 4 PM, Sat 5 PM" - users want
//    different days to choose from, not three near-identical slots.
//  - Earliness penalty: each hour past the heatmap start subtracts
//    LATE_PENALTY_PER_HOUR from the window's weight when comparing slots.
//    A late-evening slot has to beat a morning slot by a meaningful number
//    of extra attendees to win - people are reluctant to show up and stay
//    late, so we lean earlier when attendance is close.
const TOURNAMENT_WINDOW_HOURS = 4;
const LATE_PENALTY_PER_HOUR = 1.5;

function isProfileFreeForWindow(profile, date, startHour, windowHours) {
  for (let h = startHour; h < startHour + windowHours; h++) {
    if (isProfileBusy(profile, date, h)) return false;
  }
  return true;
}

function windowScore(date, startHour, windowHours) {
  let weight = 0;
  let count = 0;
  for (const p of profiles) {
    if (!isProfileFreeForWindow(p, date, startHour, windowHours)) continue;
    weight += (typeof p.attendance === 'number' ? p.attendance : 5);
    count++;
  }
  return { weight, count };
}

function adjustedWindowScore(weight, startHour) {
  // Linear earliness preference: each hour past the heatmap start eats a
  // bit of the weight. A morning window with slightly fewer attendees can
  // outrank a late-evening one once the lateness penalty exceeds the
  // attendance gap (default ~3 typical attendees over 10 hours).
  return weight - LATE_PENALTY_PER_HOUR * (startHour - HEATMAP_HOUR_START);
}

function topBestSlots(limit = 3) {
  const W = TOURNAMENT_WINDOW_HOURS;
  // start + W must fit inside the heatmap band; last hour the block can
  // occupy is HEATMAP_HOUR_END (inclusive), so latest start is
  // HEATMAP_HOUR_END + 1 - W.
  const latestStart = HEATMAP_HOUR_END + 1 - W;

  // Collapse to one window per date: pick the day's best window, then
  // rank dates against each other. Avoids stacking the top picks on a
  // single attendance-heavy date.
  const days = [];
  for (const date of datesInRange()) {
    let best = null;
    for (let h = HEATMAP_HOUR_START; h <= latestStart; h++) {
      const { weight, count } = windowScore(date, h, W);
      const score = adjustedWindowScore(weight, h);
      if (!best ||
          score > best.score ||
          (score === best.score && count > best.count) ||
          (score === best.score && count === best.count && h < best.startHour)) {
        best = { date, startHour: h, endHour: h + W, weight, count, score };
      }
    }
    if (best) days.push(best);
  }
  days.sort((a, b) =>
    b.score - a.score ||
    b.count - a.count ||
    a.date.localeCompare(b.date) ||
    a.startHour - b.startHour
  );
  return days.slice(0, limit);
}

function getRecentShiftTimes(limit = 5) {
  // Aggregate all shifts across all profiles; rank distinct (start,end)
  // ranges by frequency, tie-break by most-recent use (highest id).
  const stats = new Map(); // key "s-e" -> { startHour, endHour, count, latestId }
  for (const p of profiles) {
    if (!Array.isArray(p.shifts)) continue;
    for (const s of p.shifts) {
      const key = `${s.startHour}-${s.endHour}`;
      const cur = stats.get(key);
      if (cur) {
        cur.count++;
        if (s.id > cur.latestId) cur.latestId = s.id;
      } else {
        stats.set(key, { startHour: s.startHour, endHour: s.endHour, count: 1, latestId: s.id || 0 });
      }
    }
  }
  return Array.from(stats.values())
    .sort((a, b) => b.count - a.count || b.latestId - a.latestId)
    .slice(0, limit);
}

function addShiftRecord(profile, date, startHour, endHour) {
  if (endHour <= startHour) {
    // Cross-midnight: split into two consecutive-date shifts. Storage
    // invariant is endHour > startHour, so the two halves are independent
    // records from here on (editing one doesn't ripple to the other).
    profile.shifts.push({ id: nextShiftId(), date, startHour, endHour: 24 });
    profile.shifts.push({ id: nextShiftId(), date: nextDate(date), startHour: 0, endHour });
    return 2;
  }
  profile.shifts.push({ id: nextShiftId(), date, startHour, endHour });
  return 1;
}

function removeShift(profileId, shiftId) {
  const p = getProfileById(profileId);
  if (!p || !Array.isArray(p.shifts)) return;
  p.shifts = p.shifts.filter(s => s.id !== shiftId);
  saveProfilesToStorage();
}

// ---- Schedule screen navigation ----

function openScheduleScreen() {
  closeAmbientAnimations();
  hideMenu();
  currentScreen = 'schedule';
  if (!scheduleRange) scheduleRange = loadScheduleRange();
  setScheduleSubview('heatmap');
  renderScheduleHeatmap();
  render();
}

function closeScheduleScreen() {
  currentScreen = 'home';
  currentScheduleProfileId = null;
  editingShift = null;
  render();
}

function goBackInSchedule() {
  if (scheduleSubview === 'shift-form') {
    setScheduleSubview('profile-shifts');
    return;
  }
  if (scheduleSubview === 'profile-shifts') {
    setScheduleSubview('profile-picker');
    renderScheduleProfilePicker();
    return;
  }
  if (scheduleSubview === 'profile-picker') {
    setScheduleSubview('heatmap');
    renderScheduleHeatmap();
    return;
  }
  closeScheduleScreen();
}

function setScheduleSubview(name) {
  scheduleSubview = name;
  const vp = document.querySelector('.schedule-viewport');
  if (vp) vp.dataset.subview = name;
  document.body.dataset.scheduleSubview = name;
}

// ---- Heatmap subview ----

function onScheduleRangeChange() {
  const startEl = document.getElementById('schedule-range-start');
  const endEl   = document.getElementById('schedule-range-end');
  if (!startEl || !endEl) return;
  const start = startEl.value;
  const end   = endEl.value;
  if (!start || !end) return;
  if (end < start) {
    // Auto-correct rather than reject - user almost always wants the
    // second field to follow the first.
    endEl.value = start;
    scheduleRange = { startDate: start, endDate: start };
  } else {
    scheduleRange = { startDate: start, endDate: end };
  }
  saveScheduleRange();
  renderScheduleHeatmap();
}

function renderScheduleHeatmap() {
  if (!scheduleRange) scheduleRange = loadScheduleRange();
  const startEl = document.getElementById('schedule-range-start');
  const endEl   = document.getElementById('schedule-range-end');
  if (startEl && !startEl.value) startEl.value = scheduleRange.startDate;
  if (endEl   && !endEl.value)   endEl.value   = scheduleRange.endDate;
  if (startEl) startEl.value = scheduleRange.startDate;
  if (endEl)   endEl.value   = scheduleRange.endDate;

  renderBestSlots();
  renderHeatmapGrid();
}

function renderBestSlots() {
  const container = document.getElementById('schedule-best-slots');
  if (!container) return;
  const total = profiles.length;
  if (!total) {
    container.innerHTML = `<div class="schedule-best-slot-card is-empty"><span class="schedule-best-slot-rank">No profiles yet</span><span class="schedule-best-slot-when">Add profiles first</span><span class="schedule-best-slot-free">Then mark when they're busy</span></div>`;
    return;
  }
  const slots = topBestSlots(3);
  if (!slots.length) {
    container.innerHTML = `<div class="schedule-best-slot-card is-empty"><span class="schedule-best-slot-when">Pick a date range</span></div>`;
    return;
  }
  container.innerHTML = slots.map((s, i) => {
    const d = parseIsoToDate(s.date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const md  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = formatHour12(s.endHour);
    const range = `${formatHour12(s.startHour)} – ${endLabel}`;
    return `
      <button type="button" class="schedule-best-slot-card" onclick="scrollToCell('${s.date}', ${s.startHour})">
        <span class="schedule-best-slot-rank">#${i + 1} best</span>
        <span class="schedule-best-slot-when">${esc(dow)} ${esc(md)} · ${esc(range)}</span>
        <span class="schedule-best-slot-free">${s.count}/${total} can stay</span>
      </button>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Schedule sharing: render the top-5 best slots + heatmap + cast list to a
// single PNG and hand it to the OS share sheet (iOS: Save to Photos /
// Messages / AirDrop). Sibling "Copy text" path pastes a bullet list of the
// same five slots so users can drop the gist into a chat without an image.
// ---------------------------------------------------------------------------

// Solid colors baked from the in-app translucent bucket palette (see
// .schedule-heatmap-cell[data-bucket=...] in styles.css) against the
// #0c0d10 page background. Keeps the exported grid visually consistent
// with what users see in the app.
const HEATMAP_CANVAS_PALETTE = [
  { fill: '#351719', text: '#d05a5a', bold: false }, // 0 free
  { fill: '#1e1114', text: '#8a8a8a', bold: false }, // some, < 25%
  { fill: '#242016', text: '#ffc94d', bold: false }, // 25-50%
  { fill: '#112c24', text: '#2ee8a0', bold: false }, // 50-75%
  { fill: '#164f3b', text: '#2ee8a0', bold: true  }, // 75-100%
];

function canvasRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function buildShareSlotsText(slots) {
  // Plain-text bullet list used for both "Copy text" and as the body of
  // the share-sheet payload alongside the image.
  const total = profiles.length;
  const lines = [];
  slots.forEach((s, i) => {
    const d = parseIsoToDate(s.date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const md  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = formatHour12(s.endHour);
    lines.push(`#${i + 1} ${dow} ${md} · ${formatHour12(s.startHour)} – ${endLabel} (${s.count}/${total} can stay)`);
  });
  return lines.join('\n');
}

function buildShareFullText() {
  const dates = datesInRange();
  const slots = topBestSlots(5);
  const startD = parseIsoToDate(dates[0]);
  const endD   = parseIsoToDate(dates[dates.length - 1]);
  const startStr = startD.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr   = endD.toLocaleDateString(undefined,   { month: 'short', day: 'numeric', year: 'numeric' });
  return [
    `Tournament times (${startStr} – ${endStr}):`,
    buildShareSlotsText(slots),
    '',
    `Top time fits ${slots[0].count}/${profiles.length} of the group for a full 4-hour block.`,
  ].join('\n');
}

async function copyScheduleAsText() {
  if (!profiles.length)        { showToast('Add profiles first');  return; }
  if (!datesInRange().length)  { showToast('Pick a date range');   return; }
  const text = buildShareFullText();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch (e) {
    showToast('Copy failed', { variant: 'error' });
  }
}

async function exportScheduleAsImage() {
  if (!profiles.length)       { showToast('Add profiles first'); return; }
  const dates = datesInRange();
  if (!dates.length)          { showToast('Pick a date range');  return; }

  showToast('Generating image…');

  const slots = topBestSlots(5);
  const total = profiles.length;

  // Layout constants - all in CSS pixels at 1x. Final canvas is 1080 wide.
  const W = 1080;
  const PAD = 60;
  const inner = W - PAD * 2;

  const hourCount = HEATMAP_HOUR_END - HEATMAP_HOUR_START + 1;
  const hourLabelW = 80;
  const gridAvail = inner - hourLabelW;
  // Cap cell size so a 7-day range doesn't blow up into a wall; floor so
  // a 30-day range still produces readable cells (~28px).
  const cellW = Math.max(20, Math.min(70, Math.floor(gridAvail / dates.length)));
  const cellH = Math.min(cellW, 48);
  const actualGridW = cellW * dates.length;
  // Center the grid horizontally inside the inner content area
  const gridLeftOffset = Math.floor((inner - (hourLabelW + actualGridW)) / 2);

  // Render onto a generously-tall offscreen canvas, then trim to the
  // actual content height when exporting. Avoids having to pre-compute
  // the cast section's wrap height.
  const TEMP_H = 4096;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = TEMP_H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(0, 0, W, TEMP_H);

  let y = PAD;

  // ---- Header ----
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px "Barlow Condensed", "Helvetica Neue", system-ui, sans-serif';
  ctx.fillText('SMASH PAIRING', PAD, y + 56);

  ctx.fillStyle = '#bbb';
  ctx.font = '500 22px "IBM Plex Mono", "Menlo", monospace';
  ctx.fillText('Tournament availability snapshot', PAD, y + 92);

  const startD = parseIsoToDate(dates[0]);
  const endD   = parseIsoToDate(dates[dates.length - 1]);
  const rangeLabel = `${startD.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${endD.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  ctx.fillStyle = '#888';
  ctx.font = '500 19px "IBM Plex Mono", monospace';
  ctx.fillText(`${rangeLabel} · ${total} profile${total === 1 ? '' : 's'} · 4-hour blocks`, PAD, y + 124);

  ctx.fillStyle = '#2a2d36';
  ctx.fillRect(PAD, y + 150, inner, 2);
  y += 180;

  // ---- Top 5 best slots ----
  ctx.fillStyle = '#ffc94d';
  ctx.font = 'bold 30px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText('TOP 5 TIMES', PAD, y + 28);
  y += 56;

  const slotCardH = 78;
  const slotGap = 10;
  slots.forEach((s, i) => {
    const isTop = i === 0;
    ctx.fillStyle = isTop ? '#1c2a1c' : '#15171e';
    canvasRoundRect(ctx, PAD, y, inner, slotCardH, 14);
    ctx.fill();

    if (isTop) {
      ctx.fillStyle = '#2ee8a0';
      canvasRoundRect(ctx, PAD, y, 6, slotCardH, 3);
      ctx.fill();
    }

    ctx.fillStyle = isTop ? '#2ee8a0' : '#666';
    ctx.font = 'bold 32px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(`#${i + 1}`, PAD + 24, y + 48);

    const d = parseIsoToDate(s.date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const md  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = formatHour12(s.endHour);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(`${dow} ${md} · ${formatHour12(s.startHour)} – ${endLabel}`, PAD + 92, y + 36);

    ctx.fillStyle = '#aaa';
    ctx.font = '500 16px "IBM Plex Mono", monospace';
    ctx.fillText(`${s.count}/${total} can stay`, PAD + 92, y + 62);

    // Right-aligned "weight" tag
    ctx.fillStyle = '#666';
    ctx.font = '500 14px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`score ${s.weight}`, PAD + inner - 20, y + 48);
    ctx.textAlign = 'left';

    y += slotCardH + slotGap;
  });
  y += 24;

  // ---- Availability grid ----
  ctx.fillStyle = '#ffc94d';
  ctx.font = 'bold 30px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText('AVAILABILITY GRID', PAD, y + 28);
  y += 56;

  const gridX = PAD + gridLeftOffset + hourLabelW;
  const labelX = PAD + gridLeftOffset;

  // Date column headers
  ctx.textAlign = 'center';
  dates.forEach((date, di) => {
    const d = parseIsoToDate(date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
    const cx = gridX + di * cellW + cellW / 2;
    ctx.fillStyle = '#888';
    ctx.font = 'bold 12px "IBM Plex Mono", monospace';
    ctx.fillText(dow, cx, y + 16);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 18px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(String(d.getDate()), cx, y + 38);
  });
  y += 52;

  // Hour rows
  for (let hi = 0; hi < hourCount; hi++) {
    const h = HEATMAP_HOUR_START + hi;
    const rowY = y + hi * cellH;

    ctx.fillStyle = '#777';
    ctx.font = '500 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatHour12(h), labelX + hourLabelW - 14, rowY + cellH / 2);
    ctx.textBaseline = 'alphabetic';

    for (let di = 0; di < dates.length; di++) {
      const date = dates[di];
      const free = freeCount(date, h);
      const bucket = freeBucket(free, total);
      const palette = HEATMAP_CANVAS_PALETTE[bucket];
      const cellX = gridX + di * cellW;

      ctx.fillStyle = palette.fill;
      ctx.fillRect(cellX + 1, rowY + 1, cellW - 2, cellH - 2);

      if (cellW >= 26 && cellH >= 22) {
        ctx.fillStyle = palette.text;
        const fontSize = Math.max(10, Math.min(14, cellH - 10));
        ctx.font = `${palette.bold ? 'bold' : '600'} ${fontSize}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(free), cellX + cellW / 2, rowY + cellH / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }
  y += hourCount * cellH + 36;
  ctx.textAlign = 'left';

  // ---- Cast: every profile as a chip tinted by attendance ----
  ctx.fillStyle = '#ffc94d';
  ctx.font = 'bold 30px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText('CAST', PAD, y + 28);
  y += 50;

  const chipH = 38;
  const chipGap = 8;
  const chipPadX = 14;
  let chipX = PAD;
  let chipY = y;

  for (const p of profiles) {
    const att = typeof p.attendance === 'number' ? p.attendance : 5;
    const nameText = p.name;
    const attText = ` ${att}`;
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    const nameW = ctx.measureText(nameText).width;
    ctx.font = 'bold 18px "IBM Plex Mono", monospace';
    const attW = ctx.measureText(attText).width;
    const chipW = chipPadX * 2 + nameW + attW;

    if (chipX + chipW > PAD + inner && chipX > PAD) {
      chipY += chipH + chipGap;
      chipX = PAD;
    }

    // Chip background tinted by attendance: low = dim, high = green-tinted
    const t = att / 10;
    const r = Math.round(22 + (60 - 22) * (1 - t));
    const g = Math.round(30 + (110 - 30) * t);
    const b = Math.round(40 + (80 - 40) * t);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    canvasRoundRect(ctx, chipX, chipY, chipW, chipH, 9);
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ececec';
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(nameText, chipX + chipPadX, chipY + chipH / 2);

    ctx.font = 'bold 18px "IBM Plex Mono", monospace';
    ctx.fillStyle = att >= 7 ? '#7dd87a' : (att >= 4 ? '#ffd166' : '#d96a6a');
    ctx.fillText(attText, chipX + chipPadX + nameW, chipY + chipH / 2);
    ctx.textBaseline = 'alphabetic';

    chipX += chipW + chipGap;
  }
  y = chipY + chipH + 32;

  // ---- Footer ----
  ctx.fillStyle = '#2a2d36';
  ctx.fillRect(PAD, y, inner, 2);
  y += 28;

  ctx.fillStyle = '#666';
  ctx.font = '500 13px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  const stamp = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  ctx.fillText(`Generated ${stamp}`, PAD, y + 14);
  ctx.textAlign = 'right';
  ctx.fillText('one per day · attendance + earliness weighted', PAD + inner, y + 14);
  y += 32 + PAD;

  // ---- Trim to actual height and export ----
  const finalH = Math.min(y, TEMP_H);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = finalH;
  out.getContext('2d').drawImage(canvas, 0, 0);

  out.toBlob(async (blob) => {
    if (!blob) { showToast('Image generation failed', { variant: 'error' }); return; }
    const file = new File([blob], 'smash-pairing.png', { type: 'image/png' });
    const shareText = buildShareFullText();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Tournament availability', text: shareText });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        // fall through to download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smash-pairing.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Image saved');
  }, 'image/png');
}

function renderHeatmapGrid() {
  const grid = document.getElementById('schedule-heatmap');
  const empty = document.getElementById('schedule-heatmap-empty');
  const scroll = document.getElementById('schedule-heatmap-scroll');
  if (!grid) return;
  const dates = datesInRange();
  const total = profiles.length;
  if (!dates.length || total === 0) {
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = '';
    if (scroll) scroll.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = total === 0
        ? 'Add profiles first, then mark their work shifts here.'
        : 'Pick a valid date range.';
    }
    return;
  }
  if (scroll) scroll.hidden = false;
  if (empty) empty.hidden = true;
  grid.style.gridTemplateColumns = `56px repeat(${dates.length}, 60px)`;

  const parts = [];
  // Corner cell (top-left) - sticky in both directions.
  parts.push('<div class="schedule-heatmap-cell is-corner"></div>');
  // Date header row.
  for (const date of dates) {
    const d = parseIsoToDate(date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const md  = `${d.getMonth() + 1}/${d.getDate()}`;
    parts.push(`<div class="schedule-heatmap-cell is-date-header"><span class="date-dow">${esc(dow)}</span><span class="date-md">${esc(md)}</span></div>`);
  }
  // Body: one row per hour in the daytime band (see HEATMAP_HOUR_*
  // constants). For each row, emit the hour label cell followed by one
  // cell per date. Cells are tappable - opens a modal listing who is
  // available vs busy at that (date, hour).
  for (let h = HEATMAP_HOUR_START; h <= HEATMAP_HOUR_END; h++) {
    parts.push(`<div class="schedule-heatmap-cell is-hour-label">${esc(formatHour12(h))}</div>`);
    for (const date of dates) {
      const free = freeCount(date, h);
      const bucket = freeBucket(free, total);
      parts.push(`<div class="schedule-heatmap-cell is-tappable" data-bucket="${bucket}" data-date="${esc(date)}" data-hour="${h}" role="button" tabindex="0" onclick="openScheduleCellModal('${esc(date)}', ${h})">${free}</div>`);
    }
  }
  grid.innerHTML = parts.join('');
}

function formatHour12(h) {
  // 0/24 -> "12 AM", 13 -> "1 PM", etc. Compact: no leading zero, no minutes.
  if (h === 0 || h === 24) return '12 AM';
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h > 12 ? h - 12 : h;
  return `${h12} ${period}`;
}

function scrollToCell(date, hour) {
  const grid = document.getElementById('schedule-heatmap');
  if (!grid) return;
  const cell = grid.querySelector(`.schedule-heatmap-cell[data-date="${CSS.escape(date)}"][data-hour="${hour}"]`);
  if (!cell) return;
  cell.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
  // Brief outline flash so the target cell is easy to spot after the scroll.
  cell.classList.add('is-target-flash');
  setTimeout(() => cell.classList.remove('is-target-flash'), 1400);
}

// ---- Heatmap cell-detail modal: who can vs. can't make a given hour ----

function openScheduleCellModal(date, hour) {
  const d = parseIsoToDate(date);
  const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
  const md  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  document.getElementById('schedule-cell-title').textContent =
    `${dow} ${md} · ${formatHour12(hour)}`;

  const available = [];
  const busy = [];
  for (const p of getProfilesSorted()) {
    (isProfileBusy(p, date, hour) ? busy : available).push(p);
  }

  const total = available.length + busy.length;
  document.getElementById('schedule-cell-available-count').textContent =
    `${available.length}/${total}`;
  document.getElementById('schedule-cell-busy-count').textContent =
    `${busy.length}/${total}`;
  document.getElementById('schedule-cell-available-list').innerHTML =
    renderScheduleCellList(available);
  document.getElementById('schedule-cell-busy-list').innerHTML =
    renderScheduleCellList(busy);

  document.getElementById('schedule-cell-modal').classList.add('open');
}

function renderScheduleCellList(arr) {
  if (!arr.length) return `<div class="schedule-cell-empty">No one</div>`;
  return arr.map(p => `<div class="schedule-cell-name">${esc(p.name)}</div>`).join('');
}

function hideScheduleCellModal() {
  document.getElementById('schedule-cell-modal').classList.remove('open');
}

function handleScheduleCellBackdropClick(e) {
  if (e.target === document.getElementById('schedule-cell-modal')) hideScheduleCellModal();
}

// ---- Profile-picker subview ----

function openScheduleProfilePicker() {
  setScheduleSubview('profile-picker');
  const search = document.getElementById('schedule-picker-search');
  if (search) search.value = '';
  renderScheduleProfilePicker();
}

function renderScheduleProfilePicker() {
  const container = document.getElementById('schedule-profile-picker-list');
  if (!container) return;
  const sorted = getProfilesSorted();
  if (!sorted.length) {
    container.innerHTML = '<div class="list-empty">No profiles yet. Add some from the Profiles screen first.</div>';
    return;
  }
  container.innerHTML = sorted.map(p => {
    const fid = findFighterIdByText(p.main);
    const avatar = fid
      ? `<span class="profile-avatar profile-avatar-icon ${p.skill}"><img src="assets/fighters/${fid}.webp" alt="" loading="lazy"></span>`
      : `<span class="profile-avatar ${p.skill}">${esc(p.name.charAt(0).toUpperCase())}</span>`;
    const shiftCount = Array.isArray(p.shifts) ? p.shifts.length : 0;
    const shiftLabel = shiftCount === 0
      ? 'No shifts'
      : `${shiftCount} shift${shiftCount === 1 ? '' : 's'}`;
    return `
      <button class="profile-card" data-name="${esc(p.name.toLowerCase())}" onclick="pickScheduleProfile(${p.id})">
        ${avatar}
        <span class="profile-info">
          <span class="profile-name">${esc(p.name)}</span>
          <span class="profile-main">${esc(shiftLabel)}</span>
        </span>
      </button>
    `;
  }).join('');
  filterScheduleProfilePicker();
}

// Mirrors filterMainPicker(): substring match on the lowercased name,
// hide non-matches via the `hidden` attribute, toggle an empty-state
// element when nothing matches.
function filterScheduleProfilePicker() {
  const input = document.getElementById('schedule-picker-search');
  const raw = input ? input.value : '';
  const q = raw.trim().toLowerCase();
  const cards = document.querySelectorAll('#schedule-profile-picker-list .profile-card');
  let visible = 0;
  cards.forEach(c => {
    const name = c.dataset.name || '';
    c.hidden = q ? !name.includes(q) : false;
    if (!c.hidden) visible++;
  });
  const empty = document.getElementById('schedule-picker-empty');
  if (empty) empty.hidden = !(q && visible === 0);
  const clear = document.getElementById('schedule-picker-search-clear');
  if (clear) clear.hidden = raw.length === 0;
}

function clearScheduleProfilePickerSearch() {
  const input = document.getElementById('schedule-picker-search');
  if (!input) return;
  input.value = '';
  filterScheduleProfilePicker();
  input.focus();
}

function pickScheduleProfile(id) {
  const p = getProfileById(id);
  if (!p) return;
  currentScheduleProfileId = id;
  setScheduleSubview('profile-shifts');
  renderProfileShiftsView();
}

// ---- Profile-shifts subview ----

function renderProfileShiftsView() {
  const p = getProfileById(currentScheduleProfileId);
  if (!p) return;
  const nameEl = document.getElementById('schedule-shifts-name');
  if (nameEl) nameEl.textContent = `${p.name} — shifts`;

  const list = document.getElementById('schedule-shifts-list');
  if (!list) return;
  const shifts = Array.isArray(p.shifts) ? [...p.shifts] : [];
  if (!shifts.length) {
    list.innerHTML = '<div class="schedule-shifts-empty">No shifts yet. Tap "Add shift" to mark when they\'re busy.</div>';
    return;
  }
  // Group by date, ascending.
  shifts.sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);
  const groups = new Map();
  for (const s of shifts) {
    if (!groups.has(s.date)) groups.set(s.date, []);
    groups.get(s.date).push(s);
  }
  const parts = [];
  for (const [date, items] of groups) {
    const d = parseIsoToDate(date);
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    parts.push(`<div class="schedule-shifts-date-group">`);
    parts.push(`<div class="schedule-shifts-date-label">${esc(label)}</div>`);
    for (const s of items) {
      parts.push(`
        <button type="button" class="schedule-shift-row" onclick="openShiftForm(${s.id}, '${esc(date)}')">
          <span class="shift-time">${esc(formatShiftRange(s.startHour, s.endHour))}</span>
          <svg class="shift-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </button>
      `);
    }
    parts.push(`</div>`);
  }
  list.innerHTML = parts.join('');
}

// ---- Shift-form subview ----

function openShiftForm(shiftId, comeFromDate) {
  const p = getProfileById(currentScheduleProfileId);
  if (!p) return;
  editingShift = null;
  pendingShiftReturnDate = comeFromDate || null;
  shiftFormSelectedDates = new Set();
  shiftFormAllDay = false;

  let startHour = 9;
  let endHour   = 17;
  if (shiftId != null) {
    const existing = (p.shifts || []).find(s => s.id === shiftId);
    if (existing) {
      editingShift = { ...existing };
      // (0, 24) is the canonical "unavailable all day" range. Preserve the
      // 9-5 defaults on the hidden hour selects so toggling off mid-edit
      // doesn't snap to a confusing "12 AM - 12 AM" state.
      if (existing.startHour === 0 && existing.endHour === 24) {
        shiftFormAllDay = true;
      } else {
        startHour = existing.startHour;
        endHour   = existing.endHour;
      }
      shiftFormSelectedDates.add(existing.date);
    }
  } else if (comeFromDate) {
    shiftFormSelectedDates.add(comeFromDate);
  }

  populateHourSelect('shift-start-hour', startHour, /* isEnd */ false);
  populateHourSelect('shift-end-hour',   endHour,   /* isEnd */ true);
  document.getElementById('btn-shift-delete').hidden = !editingShift;

  renderShiftRecentChips();
  renderShiftDatePills();
  updateShiftHourHint();
  applyShiftAllDayUI();

  setScheduleSubview('shift-form');
}

function toggleShiftAllDay() {
  shiftFormAllDay = !shiftFormAllDay;
  applyShiftAllDayUI();
}

function applyShiftAllDayUI() {
  const btn      = document.getElementById('schedule-allday-btn');
  const timeRow  = document.getElementById('schedule-time-row');
  const hint     = document.getElementById('schedule-hour-hint');
  if (btn) {
    btn.classList.toggle('is-on', shiftFormAllDay);
    btn.setAttribute('aria-checked', shiftFormAllDay ? 'true' : 'false');
  }
  if (timeRow) timeRow.hidden = shiftFormAllDay;
  if (hint)    hint.hidden    = shiftFormAllDay;
}

function populateHourSelect(elId, selected, isEnd) {
  const sel = document.getElementById(elId);
  if (!sel) return;
  // Start range: 0..23 ("12 AM" through "11 PM").
  // End   range: 1..24 ("1 AM"  through "12 AM" of next day).
  const min = isEnd ? 1 : 0;
  const max = isEnd ? 24 : 23;
  const opts = [];
  for (let h = min; h <= max; h++) {
    const label = h === 24 ? '12 AM (next day)' : formatHour12(h);
    opts.push(`<option value="${h}"${h === selected ? ' selected' : ''}>${esc(label)}</option>`);
  }
  sel.innerHTML = opts.join('');
}

function renderShiftRecentChips() {
  const row  = document.getElementById('schedule-recent-row');
  const chips = document.getElementById('schedule-recent-chips');
  if (!row || !chips) return;
  const recent = getRecentShiftTimes(5);
  if (!recent.length) { row.hidden = true; chips.innerHTML = ''; return; }
  row.hidden = false;
  chips.innerHTML = recent.map(r => {
    const label = formatShiftRange(r.startHour, r.endHour);
    return `<button type="button" class="schedule-recent-chip" onclick="applyRecentChip(${r.startHour}, ${r.endHour})">${esc(label)}</button>`;
  }).join('');
}

function applyRecentChip(startHour, endHour) {
  // A 0-24 range is the canonical "all day" form. Tapping that chip should
  // flip the toggle ON rather than show "12 AM - 12 AM" in the hour selects.
  if (startHour === 0 && endHour === 24) {
    shiftFormAllDay = true;
    applyShiftAllDayUI();
    return;
  }
  shiftFormAllDay = false;
  applyShiftAllDayUI();
  populateHourSelect('shift-start-hour', startHour, false);
  populateHourSelect('shift-end-hour',   endHour,   true);
  updateShiftHourHint();
}

// Shared label for a (startHour, endHour) range. (0, 24) is shown as
// "All day"; (h, 24) reads as "h - 12 AM" so the next-day implication
// is clearer than "h - 24:00".
function formatShiftRange(startHour, endHour) {
  if (startHour === 0 && endHour === 24) return 'All day';
  return `${formatHour12(startHour)} – ${formatHour12(endHour)}`;
}

function renderShiftDatePills() {
  const container = document.getElementById('schedule-date-pills');
  if (!container) return;
  const dates = datesInRange();
  if (!dates.length) {
    container.innerHTML = '<div class="schedule-shifts-empty">Set a date range on the heatmap first.</div>';
    return;
  }
  container.innerHTML = dates.map(date => {
    const d = parseIsoToDate(date);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const md  = `${d.getMonth() + 1}/${d.getDate()}`;
    const on  = shiftFormSelectedDates.has(date);
    return `<button type="button" class="schedule-date-pill${on ? ' is-on' : ''}" data-date="${esc(date)}" onclick="toggleDatePill('${esc(date)}')"><span class="pill-dow">${esc(dow)}</span>${esc(md)}</button>`;
  }).join('');
}

function toggleDatePill(date) {
  if (shiftFormSelectedDates.has(date)) shiftFormSelectedDates.delete(date);
  else shiftFormSelectedDates.add(date);
  // Toggle the class in place so we don't re-render the whole list and
  // lose scroll position when the pill row overflows.
  const pill = document.querySelector(`.schedule-date-pill[data-date="${CSS.escape(date)}"]`);
  if (pill) pill.classList.toggle('is-on', shiftFormSelectedDates.has(date));
}

function getShiftFormHours() {
  const s = parseInt(document.getElementById('shift-start-hour').value, 10);
  const e = parseInt(document.getElementById('shift-end-hour').value, 10);
  return { startHour: s, endHour: e };
}

function onShiftHourChange() { updateShiftHourHint(); }

function updateShiftHourHint() {
  const hint = document.getElementById('schedule-hour-hint');
  if (!hint) return;
  const { startHour, endHour } = getShiftFormHours();
  if (endHour === startHour) {
    hint.textContent = 'Start and end hour can\'t be the same.';
    hint.classList.add('is-error');
    return;
  }
  hint.classList.remove('is-error');
  if (endHour < startHour) {
    hint.textContent = `Crosses midnight — will save as two shifts (${formatHour12(startHour)} – 12 AM, then 12 AM – ${formatHour12(endHour)} the next day).`;
  } else {
    const span = endHour - startHour;
    hint.textContent = `${span} hour${span === 1 ? '' : 's'} busy.`;
  }
}

function saveShiftForm() {
  const p = getProfileById(currentScheduleProfileId);
  if (!p) return;
  let startHour, endHour;
  if (shiftFormAllDay) {
    startHour = 0;
    endHour   = 24;
  } else {
    ({ startHour, endHour } = getShiftFormHours());
    if (endHour === startHour) {
      showToast('Start and end hour must differ', { variant: 'error' });
      return;
    }
  }
  const dates = Array.from(shiftFormSelectedDates).sort();
  if (!dates.length) {
    showToast('Pick at least one date', { variant: 'error' });
    return;
  }
  if (!Array.isArray(p.shifts)) p.shifts = [];

  // Editing: remove the original record before re-adding, so changing the
  // hours of an existing shift updates in place rather than duplicating.
  if (editingShift) {
    p.shifts = p.shifts.filter(s => s.id !== editingShift.id);
  }

  let added = 0;
  for (const date of dates) added += addShiftRecord(p, date, startHour, endHour);
  saveProfilesToStorage();

  showToast(`Saved ${added} shift${added === 1 ? '' : 's'}`);
  editingShift = null;
  pendingShiftReturnDate = null;
  renderProfileShiftsView();
  renderScheduleHeatmap();   // keeps the heatmap fresh for when the user navigates back
  setScheduleSubview('profile-shifts');
}

async function deleteEditingShift() {
  if (!editingShift) return;
  const ok = await showConfirm({
    title: 'Delete shift?',
    body: 'This single shift will be removed.',
    danger: true,
    confirmLabel: 'Delete'
  });
  if (!ok) return;
  removeShift(currentScheduleProfileId, editingShift.id);
  editingShift = null;
  renderProfileShiftsView();
  renderScheduleHeatmap();
  setScheduleSubview('profile-shifts');
}

// Wrapper used by the menu option buttons so picking a mode auto-closes
// the sheet, matching the mobile "tap to choose" pattern.
function selectMode(mode) {
  setMode(mode);
  hideMenu();
}

function openAbout() {
  closeAmbientAnimations();
  hideMenu();
  document.getElementById('about-version').textContent = APP_VERSION;
  document.getElementById('about-modal').classList.add('open');
}

function hideAbout() {
  document.getElementById('about-modal').classList.remove('open');
}

function handleAboutBackdropClick(e) {
  if (e.target === document.getElementById('about-modal')) hideAbout();
}

function openHowToPlay() {
  closeAmbientAnimations();
  hideMenu();
  document.getElementById('how-to-play-modal').classList.add('open');
}

function hideHowToPlay() {
  document.getElementById('how-to-play-modal').classList.remove('open');
}

function handleHowToPlayBackdropClick(e) {
  if (e.target === document.getElementById('how-to-play-modal')) hideHowToPlay();
}

// All localStorage keys the app owns. Export/Import/Reset all walk this list,
// so adding a new persisted key in one place keeps every data action in sync.
const ALL_STORAGE_KEYS = [STORAGE_KEY, PRESETS_KEY, PROFILES_KEY, SCHEDULE_RANGE_KEY];

function exportData() {
  hideMenu();
  try {
    const data = {};
    for (const key of ALL_STORAGE_KEYS) data[key] = localStorage.getItem(key);
    const payload = {
      app: 'smash-pairing',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smash-pairing-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('Backup downloaded');
  } catch (e) {
    showToast('Export failed', { variant: 'error' });
  }
}

function triggerImport() {
  hideMenu();
  document.getElementById('import-file-input').click();
}

async function handleImportFile(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  // Clear the value so picking the same file again later still fires change.
  input.value = '';
  if (!file) return;

  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (e) {
    showToast('Could not read file', { variant: 'error' });
    return;
  }

  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    showToast('Not a Smash Pairing backup', { variant: 'error' });
    return;
  }
  const hasAnyKey = ALL_STORAGE_KEYS.some(k => Object.prototype.hasOwnProperty.call(payload.data, k));
  if (!hasAnyKey) {
    showToast('Not a Smash Pairing backup', { variant: 'error' });
    return;
  }

  const ok = await showConfirm({
    title: 'Replace all data with this backup?',
    body: 'Your current roster, presets, profiles, and schedule will be overwritten. This cannot be undone.',
    danger: true,
    confirmLabel: 'Import'
  });
  if (!ok) return;

  try {
    for (const key of ALL_STORAGE_KEYS) {
      const value = payload.data[key];
      if (typeof value === 'string') {
        localStorage.setItem(key, value);
      } else if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        // Defensive: accept already-parsed objects too.
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  } catch (e) {
    showToast('Import failed', { variant: 'error' });
    return;
  }
  // Push the imported data up before reloading so the reload's syncOnLoad
  // doesn't race a still-pending debounced push and lose it.
  if (window.SmashSync && window.SmashSync.isEnabled() && window.SmashSync.getCurrentUser()) {
    try { await window.SmashSync.pushAllNow(); } catch (_) {}
  }
  location.reload();
}

async function confirmResetAll() {
  hideMenu();
  const ok = await showConfirm({
    title: 'Reset all data?',
    body: 'This permanently clears your roster, presets, profiles, and schedule. This cannot be undone.',
    danger: true,
    confirmLabel: 'Reset'
  });
  if (!ok) return;
  try {
    for (const key of ALL_STORAGE_KEYS) localStorage.removeItem(key);
  } catch (e) { /* if storage is unavailable, reload will still re-init defaults */ }
  // Mirror the wipe to the user's Supabase account so cross-device stays
  // consistent. No-op when logged out or sync disabled.
  if (window.SmashSync && window.SmashSync.isEnabled() && window.SmashSync.getCurrentUser()) {
    try { await window.SmashSync.clearRemote(); } catch (_) {}
  }
  location.reload();
}

// Inline info-circle icon used in the leftover hints under each unpaired bucket.
const HINT_ICON_HTML = `
  <svg class="hint-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="7.25" y="6.5" width="1.5" height="5" rx="0.5"/>
    <circle cx="8" cy="4.5" r="0.85"/>
  </svg>`;

// Toast icons (checkmark for success, warning triangle for error).
const TOAST_CHECK_HTML = `
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 8.5 L6.5 12 L13 4.5"/>
  </svg>`;

const TOAST_WARN_HTML = `
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 2 L14.5 13.5 L1.5 13.5 Z"/>
    <line x1="8" y1="6.5" x2="8" y2="10"/>
    <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
  </svg>`;

let _toastTimer = null;

// Reusable toast. Replace semantics: latest call wins, timer resets. Tap toast
// to dismiss early. Lives outside any modal so it survives modal hide.
function showToast(message, options = {}) {
  const { variant = 'success', duration = 2500 } = options;
  const toast  = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const textEl = document.getElementById('toast-text');

  if (_toastTimer) clearTimeout(_toastTimer);

  textEl.textContent = message;
  toast.classList.remove('success', 'error');
  toast.classList.add(variant);
  iconEl.innerHTML = variant === 'error' ? TOAST_WARN_HTML : TOAST_CHECK_HTML;

  toast.hidden = false;
  // Force reflow so the .show transition animates from the just-unhidden state.
  void toast.offsetWidth;
  toast.classList.add('show');

  _toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  if (_toastTimer) {
    clearTimeout(_toastTimer);
    _toastTimer = null;
  }
  const toast = document.getElementById('toast');
  toast.classList.remove('show');
  // Hide after the fade-out completes so the element doesn't intercept taps.
  setTimeout(() => {
    if (!toast.classList.contains('show')) toast.hidden = true;
  }, 220);
}

let _confirmResolver = null;

// Promise-based confirm sheet. Resolves true on Confirm; false on Cancel,
// backdrop tap, or Escape. Single-instance: a second call while one is open
// resolves the previous Promise false (won't happen in today's flows, but
// keeps the API safe).
function showConfirm({ title, body = '', danger = false, confirmLabel = 'Confirm' } = {}) {
  closeAmbientAnimations();
  return new Promise(resolve => {
    if (_confirmResolver) _confirmResolver(false);
    _confirmResolver = resolve;

    document.getElementById('confirm-title').textContent = title;

    const bodyEl = document.getElementById('confirm-body');
    if (body) {
      bodyEl.textContent = body;
      bodyEl.hidden = false;
    } else {
      bodyEl.hidden = true;
    }

    const sheet = document.getElementById('confirm-sheet');
    sheet.classList.remove('is-input', 'is-danger');
    sheet.classList.add(danger ? 'is-danger' : 'is-input');

    document.getElementById('confirm-ok-btn').textContent = confirmLabel;
    document.getElementById('confirm-modal').classList.add('open');

    // Focus Cancel for destructive actions so a stray Enter doesn't confirm.
    requestAnimationFrame(() => {
      const focusTarget = danger
        ? document.querySelector('#confirm-modal .btn-close-modal')
        : document.getElementById('confirm-ok-btn');
      if (focusTarget) focusTarget.focus();
    });
  });
}

function resolveConfirm(value) {
  document.getElementById('confirm-modal').classList.remove('open');
  if (_confirmResolver) {
    _confirmResolver(value);
    _confirmResolver = null;
  }
}

function handleConfirmBackdropClick(e) {
  if (e.target === document.getElementById('confirm-modal')) resolveConfirm(false);
}

// Build the Pair Waiting button label. Returns null when there's nothing to
// pair (button gets hidden by the caller).
function pairWaitingLabel(mode, uExp, uInexp) {
  const teamWord = n => n === 1 ? 'team' : 'teams';
  if (mode === 'split') {
    const expPairs   = Math.floor(uExp / 2);
    const inexpPairs = Math.floor(uInexp / 2);
    const totalPairs = expPairs + inexpPairs;
    if (totalPairs === 0) return null;
    if (expPairs > 0 && inexpPairs > 0) {
      const players = (expPairs + inexpPairs) * 2;
      return `Pair ${players} players (${totalPairs} teams: ${expPairs} exp + ${inexpPairs} inexp)`;
    }
    if (expPairs > 0) {
      return `Pair ${expPairs * 2} experienced (${expPairs} ${teamWord(expPairs)})`;
    }
    return `Pair ${inexpPairs * 2} inexperienced (${inexpPairs} ${teamWord(inexpPairs)})`;
  }
  const pairs = Math.min(uExp, uInexp);
  if (pairs === 0) return null;
  return `Pair ${pairs * 2} players (${pairs} ${teamWord(pairs)})`;
}

// Build the per-bucket leftover hint text. Returns null when no strand exists
// for the given category in the current mode.
function leftoverHintText(mode, uExp, uInexp, category) {
  let strand, needCategory;
  if (mode === 'split') {
    strand = (category === 'exp' ? uExp : uInexp) % 2;
    needCategory = category;                  // same category fills the leftover
  } else {
    const pairs = Math.min(uExp, uInexp);
    strand = (category === 'exp' ? uExp : uInexp) - pairs;
    needCategory = category === 'exp' ? 'inexp' : 'exp';
  }
  if (strand <= 0) return null;
  const needName = needCategory === 'exp' ? 'experienced' : 'inexperienced';
  const subject  = strand === 1 ? 'this 1' : `these ${strand}`;
  return `Need ${strand} more ${needName} to pair ${subject}`;
}

function renderResults() {
  const results = document.getElementById('results');
  if (!state.hasPaired) { results.classList.remove('show'); return; }
  results.classList.add('show');

  const expById   = Object.fromEntries(state.exp.map(p => [p.id, p]));
  const inexpById = Object.fromEntries(state.inexp.map(p => [p.id, p]));

  const cards = [];
  let teamNum = 0;

  state.fixedPairs.forEach(fp => {
    teamNum++;
    const num = String(teamNum).padStart(2, '0');
    const nm  = fp.name ? esc(fp.name) : '';
    cards.push(`
      <div class="team-card fixed">
        <span class="team-num">${num}</span>
        <div class="team-body">
          <input
            class="team-name-input"
            type="text"
            maxlength="40"
            placeholder="Team ${num} (tap to name)"
            aria-label="Team ${num} name"
            value="${nm}"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            onchange="setFixedTeamName(${fp.id}, this.value)">
          <div class="team-member set">
            <span class="member-dot set"></span>
            <span class="member-name set">${esc(fp.aName)}</span>
          </div>
          <hr class="team-hr">
          <div class="team-member set">
            <span class="member-dot set"></span>
            <span class="member-name set">${esc(fp.bName)}</span>
          </div>
        </div>
      </div>`);
  });

  state.pairs.forEach((pair, i) => {
    let aPlayer, bPlayer, aClass, bClass;
    if (pair.kind === 'exp') {
      aPlayer = expById[pair.aId]; bPlayer = expById[pair.bId];
      aClass = bClass = 'exp';
    } else if (pair.kind === 'inexp') {
      aPlayer = inexpById[pair.aId]; bPlayer = inexpById[pair.bId];
      aClass = bClass = 'inexp';
    } else { // 'mixed'
      aPlayer = expById[pair.aId]; bPlayer = inexpById[pair.bId];
      aClass = 'exp'; bClass = 'inexp';
    }
    if (!aPlayer || !bPlayer) return;
    teamNum++;
    const num  = String(teamNum).padStart(2, '0');
    const nm   = pair.name ? esc(pair.name) : '';
    const sel  = swapSelection;
    const aSel = sel && sel.playerId === pair.aId ? ' selected' : '';
    const bSel = sel && sel.playerId === pair.bId ? ' selected' : '';
    cards.push(`
      <div class="team-card">
        <span class="team-num">${num}</span>
        <div class="team-body">
          <input
            class="team-name-input"
            type="text"
            maxlength="40"
            placeholder="Team ${num} (tap to name)"
            aria-label="Team ${num} name"
            value="${nm}"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            onchange="setTeamName(${i}, this.value)">
          <div class="team-member ${aClass}${aSel}" tabindex="0" role="button"
               onclick="selectForSwap('${aClass}', ${i}, ${aPlayer.id})"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
            <span class="member-dot ${aClass}"></span>
            <span class="member-name ${aClass}">${esc(aPlayer.name)}</span>
          </div>
          <hr class="team-hr">
          <div class="team-member ${bClass}${bSel}" tabindex="0" role="button"
               onclick="selectForSwap('${bClass}', ${i}, ${bPlayer.id})"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
            <span class="member-dot ${bClass}"></span>
            <span class="member-name ${bClass}">${esc(bPlayer.name)}</span>
          </div>
        </div>
      </div>`);
  });

  document.getElementById('pairs-list').innerHTML = cards.length
    ? cards.join('')
    : '<div class="list-empty">No teams</div>';

  const hint = document.getElementById('swap-hint');
  if (swapSelection) {
    const cat = swapSelection.category === 'exp' ? 'experienced' : 'inexperienced';
    hint.textContent = `Tap another ${cat} player to swap, or tap the same one to cancel.`;
    hint.className   = `swap-hint show ${swapSelection.category}`;
  } else {
    hint.className   = 'swap-hint';
    hint.textContent = '';
  }

  const uExp      = unpairedExp();
  const uExpBlock = document.getElementById('unpaired-exp-block');
  if (uExp.length) {
    uExpBlock.style.display = 'block';
    document.getElementById('unpaired-exp-tags').innerHTML =
      uExp.map(p => `<span class="unpaired-tag exp">${esc(p.name)}</span>`).join('');
  } else {
    uExpBlock.style.display = 'none';
  }

  const uInexp      = unpairedInexp();
  const uInexpBlock = document.getElementById('unpaired-inexp-block');
  if (uInexp.length) {
    uInexpBlock.style.display = 'block';
    document.getElementById('unpaired-inexp-tags').innerHTML =
      uInexp.map(p => `<span class="unpaired-tag inexp">${esc(p.name)}</span>`).join('');
  } else {
    uInexpBlock.style.display = 'none';
  }

  const pairBtn  = document.getElementById('btn-pair-unpaired');
  const btnLabel = pairWaitingLabel(state.mode, uExp.length, uInexp.length);
  pairBtn.style.display = btnLabel === null ? 'none' : 'block';
  if (btnLabel !== null) pairBtn.textContent = btnLabel;

  // Per-bucket leftover hints. Each bucket's hint hides naturally with the
  // parent .unpaired-block when the bucket is empty (display:none cascades).
  ['exp', 'inexp'].forEach(cat => {
    const hintEl = document.getElementById(`unpaired-${cat}-hint`);
    const text   = leftoverHintText(state.mode, uExp.length, uInexp.length, cat);
    if (text === null) {
      hintEl.hidden = true;
      return;
    }
    hintEl.hidden = false;
    hintEl.innerHTML = `${HINT_ICON_HTML}<span>${esc(text)}</span>`;
  });
}

// ---- Challonge export ----

function buildExportText() {
  const expById   = Object.fromEntries(state.exp.map(p => [p.id, p]));
  const inexpById = Object.fromEntries(state.inexp.map(p => [p.id, p]));

  const lines = [];

  state.fixedPairs.forEach(fp => {
    lines.push(fp.name || `${fp.aName} & ${fp.bName}`);
  });

  state.pairs.forEach(pair => {
    let a, b;
    if (pair.kind === 'exp')        { a = expById[pair.aId];   b = expById[pair.bId];   }
    else if (pair.kind === 'inexp') { a = inexpById[pair.aId]; b = inexpById[pair.bId]; }
    else                            { a = expById[pair.aId];   b = inexpById[pair.bId]; }
    if (a && b) lines.push(pair.name || `${a.name} & ${b.name}`);
  });

  const uExp   = unpairedExp();
  const uInexp = unpairedInexp();

  if (uExp.length || uInexp.length) {
    if (lines.length) lines.push('');
    uExp.forEach(p   => lines.push(`${p.name} & N/A`));
    uInexp.forEach(p => lines.push(`N/A & ${p.name}`));
  }

  return lines.join('\n');
}

// ---- roster presets ----

function openPresets() {
  closeAmbientAnimations();
  document.getElementById('preset-save-name').value = '';
  renderPresetsList();
  document.getElementById('presets-modal').classList.add('open');
}

function hidePresets() {
  document.getElementById('presets-modal').classList.remove('open');
}

function handlePresetsBackdropClick(e) {
  if (e.target === document.getElementById('presets-modal')) hidePresets();
}

function renderPresetsList() {
  const list = document.getElementById('preset-list');
  if (!presets.length) {
    list.innerHTML = '<div class="preset-empty">No presets yet. Save the current roster below.</div>';
    return;
  }
  list.innerHTML = presets.map(p => {
    const isEditing = (p.id === editingPresetId);
    return `
    <div class="preset-row${isEditing ? ' is-editing' : ''}">
      <div class="preset-info">
        ${isEditing
          ? `<input class="preset-name-input" type="text" maxlength="40"
                data-id="${p.id}" value="${esc(p.name)}"
                autocomplete="off" autocorrect="off" spellcheck="false"
                onblur="commitPresetRename(${p.id}, this.value)"
                onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">`
          : `<span class="preset-name">${esc(p.name)}</span>`}
        <span class="preset-counts">${p.exp.length} exp &middot; ${p.inexp.length} inexp${(p.fixedPairs && p.fixedPairs.length) ? ` &middot; ${p.fixedPairs.length} set` : ''}</span>
      </div>
      ${isEditing ? '' : `
      <div class="preset-actions">
        <button class="btn-preset-load"   onclick="loadPreset(${p.id})">Load</button>
        <button class="btn-preset-rename" onclick="renamePreset(${p.id})">Rename</button>
        <button class="btn-preset-delete" onclick="deletePreset(${p.id})">Delete</button>
      </div>`}
    </div>`;
  }).join('');
}

async function saveCurrentAsPreset() {
  const input = document.getElementById('preset-save-name');
  const name  = input.value.trim();
  if (!name) return;
  if (!state.exp.length && !state.inexp.length && !state.fixedPairs.length) {
    showToast('Add some players first', { variant: 'error' });
    return;
  }
  const expNames   = state.exp.map(p => p.name);
  const inexpNames = state.inexp.map(p => p.name);
  const fixedSaved = state.fixedPairs.map(fp => ({ aName: fp.aName, bName: fp.bName }));
  const existing   = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const ok = await showConfirm({
      title: 'Overwrite preset?',
      body: `«${existing.name}» will be replaced with the current roster.`,
      confirmLabel: 'Overwrite',
      danger: true,
    });
    if (!ok) return;
    existing.name  = name;
    existing.exp   = expNames;
    existing.inexp = inexpNames;
    existing.fixedPairs = fixedSaved;
  } else {
    presets.push({ id: Date.now(), name, exp: expNames, inexp: inexpNames, fixedPairs: fixedSaved });
  }
  savePresets();
  input.value = '';
  renderPresetsList();
}

async function loadPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  if (state.exp.length || state.inexp.length || state.fixedPairs.length) {
    const ok = await showConfirm({
      title: 'Replace roster?',
      body: 'Your current roster will be discarded.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
  }
  state.exp        = preset.exp.map(n => ({ id: nextId(), name: n }));
  state.inexp      = preset.inexp.map(n => ({ id: nextId(), name: n }));
  state.fixedPairs = (preset.fixedPairs || []).map(fp => ({ id: nextId(), aName: fp.aName, bName: fp.bName }));
  state.pairs      = [];
  state.hasPaired  = false;
  saveState();
  render();
  hidePresets();
}

// Flips the row into inline edit mode. Commit happens on Enter / blur via
// commitPresetRename. No explicit Cancel - matches the player-rename pattern.
function renamePreset(id) {
  if (!presets.find(p => p.id === id)) return;
  editingPresetId = id;
  renderPresetsList();
  requestAnimationFrame(() => {
    const input = document.querySelector(`#preset-list .preset-name-input[data-id="${id}"]`);
    if (input) { input.focus(); input.select(); }
  });
}

function commitPresetRename(id, rawValue) {
  const preset = presets.find(p => p.id === id);
  if (!preset) { editingPresetId = null; renderPresetsList(); return; }

  const newName = rawValue.trim();
  if (!newName || newName === preset.name) {
    editingPresetId = null;
    renderPresetsList();
    return;
  }

  const clash = presets.find(p => p.id !== id &&
                                  p.name.toLowerCase() === newName.toLowerCase());
  if (clash) {
    showToast('Name already taken', { variant: 'error' });
    // Stay in edit mode and refocus so the user can fix it without re-tapping Rename.
    requestAnimationFrame(() => {
      const input = document.querySelector(`#preset-list .preset-name-input[data-id="${id}"]`);
      if (input) input.focus();
    });
    return;
  }

  preset.name = newName;
  savePresets();
  editingPresetId = null;
  renderPresetsList();
}

async function deletePreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  const ok = await showConfirm({
    title: 'Delete preset?',
    body: `«${preset.name}» will be removed permanently.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  presets = presets.filter(p => p.id !== id);
  savePresets();
  renderPresetsList();
}

function openBulkAdd(type) {
  closeAmbientAnimations();
  const modal = document.getElementById('bulk-modal');
  modal.dataset.type = type;
  document.getElementById('bulk-title').textContent =
    type === 'exp' ? 'Add Experienced' : 'Add Inexperienced';
  const ta = document.getElementById('bulk-text');
  ta.value = '';
  updateBulkCount();
  modal.classList.add('open');
  setTimeout(() => ta.focus(), 100);
}

function hideBulkAdd() {
  document.getElementById('bulk-modal').classList.remove('open');
}

function handleBulkBackdropClick(e) {
  if (e.target === document.getElementById('bulk-modal')) hideBulkAdd();
}

function parseBulkNames(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function updateBulkCount() {
  const names = parseBulkNames(document.getElementById('bulk-text').value);
  const btn   = document.getElementById('btn-bulk-add');
  btn.textContent = `Add ${names.length} ${names.length === 1 ? 'Player' : 'Players'}`;
  btn.disabled    = names.length === 0;
}

function addBulkPlayers() {
  const modal = document.getElementById('bulk-modal');
  const type  = modal.dataset.type;
  const names = parseBulkNames(document.getElementById('bulk-text').value);
  if (!names.length || (type !== 'exp' && type !== 'inexp')) return;
  for (const name of names) {
    state[type].push({ id: nextId(), name });
  }
  saveState();
  render();
  hideBulkAdd();
}

function showExport() {
  closeAmbientAnimations();
  document.getElementById('export-text').value = buildExportText();
  document.getElementById('export-modal').classList.add('open');
}

function hideExport() {
  document.getElementById('export-modal').classList.remove('open');
}

function handleBackdropClick(e) {
  if (e.target === document.getElementById('export-modal')) hideExport();
}

function copyExport() {
  const text = document.getElementById('export-text').value;
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => {
      // Older WebView fallback - still routes through the toast so the user
      // gets the same feedback either way.
      const ta = document.getElementById('export-text');
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (ok) showToast('Copied to clipboard');
      else    showToast('Copy failed', { variant: 'error' });
    });
}

async function shareExport() {
  try {
    await navigator.share({
      title: 'Smash Pairing teams',
      text:  buildExportText(),
    });
    hideExport();  // auto-close only on successful share
  } catch (e) {
    // Silent: AbortError on user cancel is normal; other errors aren't actionable.
  }
}

document.getElementById('exp-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer('exp');
});
document.getElementById('inexp-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer('inexp');
});
document.getElementById('exp-input-r').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer('exp', 'exp-input-r');
});
document.getElementById('inexp-input-r').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer('inexp', 'inexp-input-r');
});

// Escape cancels an open confirm sheet first, otherwise navigates back from
// the Profiles screen if it's open. Confirm has priority so Esc during the
// discard-changes confirm doesn't accidentally double-pop the navigation.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('confirm-modal').classList.contains('open')) {
    resolveConfirm(false);
    return;
  }
  if (currentScreen === 'profiles') {
    goBackInProfiles();
  } else if (currentScreen === 'schedule') {
    goBackInSchedule();
  }
});

// Feature-detect Web Share. Button is hidden in HTML by default; reveal it
// once on load if navigator.share exists, so the modal renders correctly
// before showExport() is ever called.
if ('share' in navigator) {
  document.getElementById('btn-share').hidden = false;
}

// Drawer swipe-to-dismiss. 8px + axis check gates drag detection so taps on
// .menu-option still register and vertical scroll passes to native.
(function initDrawerSwipe() {
  const sheet = document.querySelector('#menu-modal .modal-sheet.is-drawer');
  if (!sheet) return;

  let startX = 0, startY = 0, dx = 0;
  let dragging = false;

  sheet.addEventListener('touchstart', e => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dx = 0;
    dragging = false;
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    const t = e.touches[0];
    dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        dragging = true;
        sheet.classList.add('is-dragging');
      } else {
        return;
      }
    }
    e.preventDefault();
    if (dx > 0) dx = 0; // no rightward drag past resting
    sheet.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    const threshold = sheet.offsetWidth * 0.35;
    // Order: re-enable transition, then change .open, then clear inline.
    // Otherwise the value change snaps with no animation, or settles to
    // translateX(0) before .open removes and animates to -100%.
    sheet.classList.remove('is-dragging');
    if (Math.abs(dx) > threshold) hideMenu();
    sheet.style.transform = '';
  });
})();

// ---- Login UI ----
//
// All of the auth UI lives in the login-gate overlay defined in index.html.
// This block is a no-op when SmashSync is disabled (placeholder config) so
// forks without Supabase keep working exactly as before.

// setLoginMode is preserved as a no-op so any cached HTML still calling it
// from an old onclick handler won't throw. The login UI is sign-in-only now;
// signups are disabled at the Supabase project level too.
function setLoginMode(_mode) {}

function showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (!gate) return;
  gate.hidden = false;
  document.documentElement.classList.add('login-locked');
  // Focus email after a tick so iOS Safari brings up the keyboard.
  const email = document.getElementById('login-email');
  setTimeout(() => { if (email && !email.value) email.focus(); }, 50);
}

function hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (!gate) return;
  gate.hidden = true;
  document.documentElement.classList.remove('login-locked');
  const pw = document.getElementById('login-password');
  if (pw) pw.value = '';
}

function friendlyAuthError(err) {
  const msg = (err && err.message) || String(err || '');
  // Log the raw error so devtools shows the original message even after we
  // map it to something friendlier in the UI.
  try { console.error('[auth]', err); } catch (_) {}
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first, then sign in. Check your inbox (and spam) for the verification link.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/user already registered/i.test(msg)) return 'An account already exists for that email. Use Sign In instead.';
  if (/email rate limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/password should be at least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/signups not allowed/i.test(msg)) return 'New sign-ups are disabled on this server.';
  if (/email address.*invalid/i.test(msg)) return 'Enter a valid email address.';
  if (/network|failed to fetch/i.test(msg)) return 'Network error. Check your connection and try again.';
  return msg || 'Something went wrong. Try again.';
}

// Guards against the button onclick + form onsubmit both firing in browsers
// that bubble click -> submit in the same task. Without this, signIn would
// run twice and the second call would race the location.reload from the first.
let _loginInFlight = false;

async function submitLogin(event) {
  if (event) event.preventDefault();
  if (_loginInFlight) return;
  _loginInFlight = true;
  const emailEl = document.getElementById('login-email');
  const pwEl    = document.getElementById('login-password');
  const err     = document.getElementById('login-error');
  const submit  = document.getElementById('login-submit');
  if (!emailEl || !pwEl || !submit) {
    _loginInFlight = false;
    return;
  }

  const email    = emailEl.value.trim();
  const password = pwEl.value;
  if (err) err.textContent = '';

  submit.disabled = true;
  submit.classList.add('is-loading');
  try {
    await window.SmashSync.signIn(email, password);
    // Tiny pause so the persisted-session write to localStorage is durable
    // before reload. Without this, some browsers reload before the SDK has
    // flushed and the session is lost.
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    if (err) err.textContent = friendlyAuthError(e);
    submit.disabled = false;
    submit.classList.remove('is-loading');
    _loginInFlight = false;
    pwEl.focus();
    pwEl.select && pwEl.select();
  }
}

async function confirmSignOut() {
  hideMenu();
  const ok = await showConfirm({
    title: 'Sign out?',
    body: 'This device will be cleared. Your data stays safe in your account and comes back the next time you sign in.',
    danger: true,
    confirmLabel: 'Sign out'
  });
  if (!ok) return;
  try { await window.SmashSync.signOut(); } catch (_) {}
  // signOut already wiped local app keys; reload to reset in-memory state.
  location.reload();
}

function refreshAuthUi(user) {
  const signOutBtn = document.getElementById('menu-signout');
  const signOutDesc = document.getElementById('menu-signout-desc');
  if (signOutBtn) signOutBtn.hidden = !user;
  if (signOutDesc && user && user.username) {
    signOutDesc.textContent = `Signed in as @${user.username}`;
  }
  // Keep the hero greeting in sync with login state.
  if (typeof renderHero === 'function') renderHero();
}

(async () => {
  // State load happens in parallel with the splash animation; both
  // must finish before we tear the splash down. In practice the state
  // load completes in <50ms and the CSS animation is the long pole,
  // but the Promise.all keeps us safe if state ever lags.
  const stateReady = (async () => {
    // If a session was restored from a previous visit, pull remote changes
    // before the first render so the user sees the latest data on boot
    // (and we avoid a visible state-then-snap reload). If sync is disabled
    // or the user is logged out, this resolves instantly with false.
    if (window.SmashSync && window.SmashSync.isEnabled()) {
      try {
        // Belt-and-suspenders: bind the form submit + button click in JS so
        // we don't depend on the cached HTML having the inline handlers.
        // Both are idempotent if the handlers are already there.
        const _form = document.getElementById('login-form');
        const _btn  = document.getElementById('login-submit');
        if (_form && !_form.dataset.bound) {
          _form.addEventListener('submit', submitLogin);
          _form.dataset.bound = '1';
          console.log('[login] form submit handler bound');
        }
        if (_btn && !_btn.dataset.bound) {
          _btn.addEventListener('click', submitLogin);
          _btn.dataset.bound = '1';
          console.log('[login] button click handler bound');
        }

        await window.SmashSync.ready;
        const user = window.SmashSync.getCurrentUser();
        if (!user) {
          // Not signed in - reveal the login gate before splash fades so
          // there's no flash of the (empty) app behind it.
          setLoginMode('signin');
          showLoginGate();
        } else {
          await window.SmashSync.syncOnLoad();
        }
        refreshAuthUi(user);
        // Keep the gate + menu in sync with later auth changes (token expiry,
        // sign-out from another tab, etc.).
        window.SmashSync.onAuthChange(u => {
          refreshAuthUi(u);
          if (!u) showLoginGate();
          else hideLoginGate();
        });
      } catch (_) {}
    }
    await loadState();
    loadPresetsFromStorage();
    loadProfilesFromStorage();
    render();
  })();

  if (splashSkipped) {
    await stateReady;
    removeSplash();
    return;
  }

  const splash = document.getElementById('splash');
  const animationDone = new Promise(resolve => {
    if (!splash) { resolve(); return; }
    // animationend bubbles, so filter to the master fade on the splash
    // itself (not Kirby / title / tagline child animations).
    splash.addEventListener('animationend', e => {
      if (e.target === splash && e.animationName === 'splash-master') {
        resolve();
      }
    });
    setTimeout(resolve, SPLASH_FALLBACK_MS);
  });

  await Promise.all([stateReady, animationDone]);
  removeSplash();
})();
