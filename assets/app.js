// Capture the splash boot time as early as possible so we can honor a
// minimum visible duration regardless of how fast state loads.
const splashStartTime = Date.now();
const SPLASH_MIN_MS   = 2000; // boot-screen beat; iOS launch icon already shows for ~1s
const SPLASH_FADE_MS  = 500;

const APP_VERSION = '0.1.0';

// True when the inline head script tagged this load as a repeat-in-session
// (e.g. a service-worker controllerchange reload). The splash is already
// hidden by CSS in that case so we only need to remove the stale element.
const splashSkipped = document.documentElement.classList.contains('splash-skip');

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  if (splashSkipped) { splash.remove(); return; }
  splash.classList.add('hidden');
  // Remove from the DOM once the fade has finished so it stops capturing
  // taps and stops painting a full-bleed layer behind the app.
  setTimeout(() => splash.remove(), SPLASH_FADE_MS + 100);
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
const PROFILES_SCHEMA_VERSION = 1;

let presets = [];
let profiles = [];

// Backup-dirty tracking: lastChangedAt advances on any profile mutation,
// lastExportedAt advances on a successful Export. profilesDirty() = the
// "show the nudge banner" decision.
let lastChangedAt = null;
let lastExportedAt = null;

// Id of the preset row currently in inline-rename edit mode (null when none).
let editingPresetId = null;

// Profile editing state. currentScreen is NOT persisted - reload always lands
// on Home/Results, never Profiles. editingProfile holds the original snapshot
// for dirty-check; profilesSubview tracks which of the two sub-views is showing.
let currentScreen = 'home';
let editingProfile = null;
let profilesSubview = 'list';

// In-progress swap selection on the Results screen. Null when no player is selected.
// Shape: { type: 'exp'|'inexp', pairIdx: number, playerId: number }
let swapSelection = null;

async function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

// Profiles persist as a versioned wrapper so we can migrate the shape in
// future without losing data. lastChangedAt / lastExportedAt drive the
// backup nudge.
function saveProfilesToStorage() {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({
      version: PROFILES_SCHEMA_VERSION,
      profiles,
      lastChangedAt,
      lastExportedAt,
    }));
  } catch(e) {
    showToast('Save failed', { variant: 'error' });
  }
}

function loadProfilesFromStorage() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy: bare array. Migrate to wrapped shape and mark as dirty
      // so the maintainer is nudged to back up the migrated state.
      profiles = parsed;
      lastChangedAt = Date.now();
      lastExportedAt = null;
      saveProfilesToStorage();
    } else if (parsed && parsed.version === PROFILES_SCHEMA_VERSION) {
      profiles       = Array.isArray(parsed.profiles) ? parsed.profiles : [];
      lastChangedAt  = parsed.lastChangedAt  || null;
      lastExportedAt = parsed.lastExportedAt || null;
    } else {
      // Unknown future version - refuse to load to avoid clobbering a
      // schema this build doesn't understand.
      console.warn('Unknown profiles schema version', parsed && parsed.version);
      profiles = [];
    }
  } catch(e) { profiles = []; }
}

function profilesDirty() {
  if (!profiles.length) return false;
  if (!lastExportedAt) return true;
  return (lastChangedAt || 0) > lastExportedAt;
}

function markProfilesChanged() {
  lastChangedAt = Date.now();
  saveProfilesToStorage();
  renderBackupNudge();
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

function render() {
  document.getElementById('home').style.display     = state.hasPaired ? 'none' : 'block';
  document.getElementById('menu-btn').style.display = state.hasPaired ? 'none' : 'flex';
  document.body.dataset.screen = currentScreen === 'profiles'
    ? 'profiles'
    : (state.hasPaired ? 'results' : 'home');
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
  renderBackupNudge();
  render();
}

function closeProfilesScreen() {
  currentScreen = 'home';
  render();
}

function goBackInProfiles() {
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
  document.getElementById('profile-notes').value = '';
  setProfileFormSkill('exp');
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
  document.getElementById('profile-notes').value = p.notes || '';
  setProfileFormSkill(p.skill);
  document.getElementById('profile-delete-btn').hidden = false;
  setProfilesSubview('form');
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
  const name  = document.getElementById('profile-name').value.trim();
  const main  = document.getElementById('profile-main').value.trim();
  const notes = document.getElementById('profile-notes').value.trim();
  const skill = getProfileFormSkill();
  if (!name) {
    showToast('Name required');
    document.getElementById('profile-name').focus();
    return;
  }
  if (editingProfile) {
    const idx = profiles.findIndex(p => p.id === editingProfile.id);
    if (idx >= 0) profiles[idx] = { ...profiles[idx], name, skill, main, notes };
  } else {
    profiles.push({ id: Date.now(), name, skill, main, notes, createdAt: Date.now() });
  }
  markProfilesChanged();
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
  markProfilesChanged();
  renderProfilesList();
  setProfilesSubview('list');
  editingProfile = null;
}

function isProfileFormDirty() {
  const name  = document.getElementById('profile-name').value.trim();
  const main  = document.getElementById('profile-main').value.trim();
  const notes = document.getElementById('profile-notes').value.trim();
  const skill = getProfileFormSkill();
  if (editingProfile) {
    return name  !== editingProfile.name ||
           main  !== (editingProfile.main  || '') ||
           notes !== (editingProfile.notes || '') ||
           skill !== editingProfile.skill;
  }
  return Boolean(name || main || notes) || skill !== 'exp';
}

function renderProfilesList() {
  const container = document.getElementById('profiles-list');
  if (!container) return;
  const sorted = getProfilesSorted();
  if (!sorted.length) {
    container.innerHTML = '<div class="list-empty">No profiles yet. Tap + to add your first one.</div>';
    return;
  }
  container.innerHTML = sorted.map(p => `
    <button class="profile-card" onclick="openEditProfileForm(${p.id})">
      <span class="profile-avatar ${p.skill}">${esc(p.name.charAt(0).toUpperCase())}</span>
      <span class="profile-info">
        <span class="profile-name">${esc(p.name)}</span>
        <span class="profile-skill-chip ${p.skill}">${p.skill === 'exp' ? 'Experienced' : 'Inexperienced'}</span>
        ${p.main ? `<span class="profile-main">Main: ${esc(p.main)}</span>` : ''}
      </span>
    </button>
  `).join('');
}

// ---- Profiles backup (export / import / nudge) ----

function exportProfiles() {
  try {
    const payload = {
      version: PROFILES_SCHEMA_VERSION,
      exportedAt: Date.now(),
      profiles,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smash-pairing-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    lastExportedAt = Date.now();
    saveProfilesToStorage();
    renderBackupNudge();
    showToast(`Exported ${profiles.length} profile${profiles.length === 1 ? '' : 's'}`);
  } catch(e) {
    showToast('Export failed', { variant: 'error' });
  }
}

function triggerImportProfiles() {
  document.getElementById('profiles-import-file').click();
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // reset so re-importing the same file works
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let parsed;
    try { parsed = JSON.parse(e.target.result); }
    catch { showToast('Could not read file', { variant: 'error' }); return; }
    if (!parsed || !Array.isArray(parsed.profiles)) {
      showToast('Invalid backup file', { variant: 'error' });
      return;
    }
    const incoming = parsed.profiles.filter(p =>
      p && typeof p.name === 'string' && (p.skill === 'exp' || p.skill === 'inexp'));
    if (!incoming.length) {
      showToast('No valid profiles in file', { variant: 'error' });
      return;
    }
    applyImport(incoming);
  };
  reader.onerror = () => showToast('Could not read file', { variant: 'error' });
  reader.readAsText(file);
}

async function applyImport(incoming) {
  let strategy;
  if (!profiles.length) {
    // Empty app: Replace and Merge are equivalent, ask one binary question.
    const ok = await showConfirm({
      title: 'Import profiles?',
      body: `Add ${incoming.length} profile${incoming.length === 1 ? '' : 's'} from this file.`,
      confirmLabel: 'Import',
    });
    if (!ok) return;
    strategy = 'replace';
  } else {
    strategy = await showImportChoice({
      existing: profiles.length,
      incoming: incoming.length,
    });
    if (strategy === 'cancel') return;
  }
  const renumbered = renumberProfiles(incoming);
  if (strategy === 'replace') {
    profiles = renumbered;
  } else {
    profiles = [...profiles, ...renumbered];
  }
  markProfilesChanged();
  renderProfilesList();
  showToast(`${strategy === 'replace' ? 'Replaced' : 'Merged'}: ${incoming.length} profile${incoming.length === 1 ? '' : 's'}`);
}

// Strip imported IDs and reassign fresh ones so they can't collide with
// existing local IDs (which are also Date.now()-based).
function renumberProfiles(list) {
  let counter = Date.now();
  return list.map(p => ({
    id: counter++,
    name: String(p.name).slice(0, 40),
    skill: p.skill,
    main: typeof p.main === 'string' ? p.main.slice(0, 32) : '',
    notes: typeof p.notes === 'string' ? p.notes.slice(0, 200) : '',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
  }));
}

// Promise-based 3-way modal mirroring showConfirm's pattern.
let _importChoiceResolver = null;

function showImportChoice({ existing, incoming }) {
  return new Promise(resolve => {
    if (_importChoiceResolver) _importChoiceResolver('cancel');
    _importChoiceResolver = resolve;
    document.getElementById('import-choice-body').textContent =
      `You have ${existing} profile${existing === 1 ? '' : 's'}. The file contains ${incoming}. ` +
      `Replace your current profiles or merge them in?`;
    document.getElementById('import-choice-modal').classList.add('open');
  });
}

function resolveImportChoice(choice) {
  document.getElementById('import-choice-modal').classList.remove('open');
  if (_importChoiceResolver) {
    _importChoiceResolver(choice);
    _importChoiceResolver = null;
  }
}

function handleImportChoiceBackdropClick(e) {
  if (e.target === document.getElementById('import-choice-modal')) resolveImportChoice('cancel');
}

function renderBackupNudge() {
  const banner = document.getElementById('profiles-backup-banner');
  const status = document.getElementById('profiles-backup-status');
  if (!banner || !status) return;
  const dirty = profilesDirty();
  banner.hidden = !dirty;
  if (dirty) {
    const sub = document.getElementById('profiles-backup-banner-sub');
    if (sub) {
      if (lastExportedAt) {
        const d = daysAgo(lastExportedAt);
        sub.textContent = `${d} day${d === 1 ? '' : 's'} since last backup`;
      } else {
        sub.textContent = 'Not backed up yet';
      }
    }
  }
  if (lastExportedAt) {
    const d = daysAgo(lastExportedAt);
    status.textContent = `Last exported ${d} day${d === 1 ? '' : 's'} ago`;
  } else {
    status.textContent = 'No exports yet';
  }
}

function daysAgo(ts) {
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

function scrollToBackupSection() {
  const section = document.getElementById('profiles-backup-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

async function confirmResetAll() {
  hideMenu();
  const ok = await showConfirm({
    title: 'Reset all data?',
    body: 'This permanently clears your roster, all presets, and any saved state. This cannot be undone.',
    danger: true,
    confirmLabel: 'Reset'
  });
  if (!ok) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PRESETS_KEY);
  } catch (e) { /* if storage is unavailable, reload will still re-init defaults */ }
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

// Escape cancels the topmost interactive layer: confirm sheet -> import-
// choice modal -> Profiles screen nav. Order matters so Esc during the
// discard-changes confirm doesn't accidentally double-pop the navigation.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('confirm-modal').classList.contains('open')) {
    resolveConfirm(false);
    return;
  }
  if (document.getElementById('import-choice-modal').classList.contains('open')) {
    resolveImportChoice('cancel');
    return;
  }
  if (currentScreen === 'profiles') {
    goBackInProfiles();
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

(async () => {
  await loadState();
  loadPresetsFromStorage();
  loadProfilesFromStorage();
  render();
  if (splashSkipped) {
    hideSplash(); // remove the hidden splash element from the DOM immediately
  } else {
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartTime));
    setTimeout(hideSplash, wait);
  }
})();
