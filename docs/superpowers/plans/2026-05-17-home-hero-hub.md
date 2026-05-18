# Home Hero + Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cinematic hero panel and a two-button navigation hub to the top of the home screen, leaving the existing pairing workspace untouched below.

**Architecture:** Pure DOM/CSS/JS additions to the existing static-asset PWA. No new dependencies, no data model changes. The hero + hub render only when the home screen is visible (`currentScreen === 'home'`). Live stats fold into the existing `render()` call chain via a new `renderHero()` helper. First-load entrance animation is gated by a `sessionStorage` flag (same pattern as the splash-skip flag).

**Tech Stack:** Vanilla HTML/CSS/JS. No build step. Served locally via `npx serve` (see `dev.bat`). Deployed as a Cloudflare Workers static asset.

**Spec:** `docs/superpowers/specs/2026-05-17-home-hero-hub-design.md`

**Verification model:** This project has no automated test framework. Every task ends with manual verification in the dev browser (`dev.bat` → http://localhost:8787, hard-refresh with Ctrl+Shift+R) and a suggested commit message. The user runs git commits themselves.

---

## File Map

| File | Change | Why |
|---|---|---|
| `index.html` | Remove `<header>`, insert hero + hub markup at the top of `#home`, bump cache-bust query strings | Adds the new DOM structure |
| `assets/styles.css` | Append `/* ---- Home hero + hub ---- */` section with all hero/hub/animation rules (~300 lines) | Visual treatment |
| `assets/app.js` | Add `renderHero()` function, call it from `render()` and after auth changes; add first-load animation gate | Live data + first-load behavior |
| `service-worker.js` | Bump `CACHE` constant | Force SW to fetch the new files |

---

## Task 1: Add hero + hub HTML markup

**Files:**
- Modify: `index.html:181-184` (remove `<header>` block)
- Modify: `index.html:186-187` (insert hero + hub right after `<div id="home">`)
- Modify: `index.html` (bump `styles.css` cache-bust at the top)

- [ ] **Step 1: Remove the existing `<header>` block**

Find this block in `index.html` (currently lines 181-184):

```html
<header>
  <h1>Smash Pairing</h1>
  <p>Team assignment</p>
</header>
```

Delete those four lines entirely.

- [ ] **Step 2: Insert hero + hub markup at the top of `#home`**

After this line:

```html
<div id="home">
```

(and before the existing `<div class="home-actions">`), insert:

```html

<!-- Home hero: cinematic welcome panel. Only rendered on the home screen.
     Stats line, headline, and Kirby visibility all controlled by JS. -->
<section class="home-hero" id="home-hero" aria-label="Welcome">
  <div class="home-hero-eyebrow">// READY UP</div>
  <h1 class="home-hero-headline" id="home-hero-headline">Welcome to Smash Pairing</h1>
  <div class="home-hero-stats" id="home-hero-stats">Add some players to get started</div>

  <!-- Kirby SVG, cloned from the splash with IDs renamed (sp-* -> hero-*) to
       avoid <defs> collision when both elements exist in the DOM. -->
  <svg class="home-hero-mascot" viewBox="0 0 1024 1024" aria-hidden="true">
    <defs>
      <radialGradient id="hero-kirby" cx="38%" cy="32%" r="72%">
        <stop offset="0%"   stop-color="#ffe2eb"/>
        <stop offset="55%"  stop-color="#ff9bb6"/>
        <stop offset="100%" stop-color="#ff5e85"/>
      </radialGradient>
      <linearGradient id="hero-eye" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#2a3a78"/>
        <stop offset="55%"  stop-color="#0a1450"/>
        <stop offset="100%" stop-color="#020616"/>
      </linearGradient>
      <radialGradient id="hero-foot" cx="50%" cy="32%" r="78%">
        <stop offset="0%"   stop-color="#ff4070"/>
        <stop offset="100%" stop-color="#a8082a"/>
      </radialGradient>
      <radialGradient id="hero-mouth" cx="50%" cy="50%" r="60%">
        <stop offset="0%"   stop-color="#ff3a72"/>
        <stop offset="100%" stop-color="#8e0e2c"/>
      </radialGradient>
    </defs>
    <g transform="translate(512 512)">
      <ellipse cx="-135" cy="252" rx="122" ry="74" fill="url(#hero-foot)" stroke="#1a0a14" stroke-width="14" transform="rotate(-18 -135 252)"/>
      <ellipse cx="150"  cy="268" rx="132" ry="76" fill="url(#hero-foot)" stroke="#1a0a14" stroke-width="14" transform="rotate(18 150 268)"/>
      <ellipse cx="-250" cy="60"  rx="72"  ry="94"  fill="url(#hero-kirby)" stroke="#1a0a14" stroke-width="14" transform="rotate(-28 -250 60)"/>
      <ellipse cx="268"  cy="78"  rx="80"  ry="104" fill="url(#hero-kirby)" stroke="#1a0a14" stroke-width="14" transform="rotate(28 268 78)"/>
      <circle  cx="0"    cy="0"   r="238"  fill="url(#hero-kirby)" stroke="#1a0a14" stroke-width="16"/>
      <ellipse cx="-78"  cy="-105" rx="86" ry="56" fill="#fff0f5" opacity="0.45"/>
      <ellipse cx="-112" cy="58"  rx="40" ry="20" fill="#ff5a87" opacity="0.85"/>
      <ellipse cx="112"  cy="58"  rx="40" ry="20" fill="#ff5a87" opacity="0.85"/>
      <ellipse cx="-72"  cy="-28" rx="30" ry="64" fill="url(#hero-eye)" stroke="#1a0a14" stroke-width="6"/>
      <ellipse cx="-74"  cy="-52" rx="22" ry="32" fill="#5e9aff" opacity="0.55"/>
      <ellipse cx="-80"  cy="-66" rx="13" ry="23" fill="#ffffff"/>
      <ellipse cx="-66"  cy="22"  rx="9"  ry="15" fill="#ffffff" opacity="0.75"/>
      <ellipse cx="72"   cy="-28" rx="30" ry="64" fill="url(#hero-eye)" stroke="#1a0a14" stroke-width="6"/>
      <ellipse cx="70"   cy="-52" rx="22" ry="32" fill="#5e9aff" opacity="0.55"/>
      <ellipse cx="64"   cy="-66" rx="13" ry="23" fill="#ffffff"/>
      <ellipse cx="78"   cy="22"  rx="9"  ry="15" fill="#ffffff" opacity="0.75"/>
      <ellipse cx="0"    cy="72"  rx="28" ry="20" fill="url(#hero-mouth)" stroke="#1a0a14" stroke-width="8"/>
      <ellipse cx="0"    cy="79"  rx="15" ry="7"  fill="#ff85a8"/>
    </g>
  </svg>
</section>

<!-- Two-button navigation hub: instant access to Profiles and Schedule
     without opening the hamburger. -->
<nav class="home-hub" aria-label="Quick navigation">
  <button class="home-hub-btn" type="button" onclick="openProfilesScreen()" aria-label="Open profiles">
    <span class="home-hub-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
      </svg>
    </span>
    <span class="home-hub-label">Profiles</span>
  </button>
  <button class="home-hub-btn is-green" type="button" onclick="openScheduleScreen()" aria-label="Open scheduling">
    <span class="home-hub-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="8" y1="3" x2="8" y2="7"/>
        <line x1="16" y1="3" x2="16" y2="7"/>
      </svg>
    </span>
    <span class="home-hub-label">Schedule</span>
  </button>
</nav>

```

- [ ] **Step 3: Bump styles.css cache-bust**

Find this line near the top of `index.html`:

```html
  <link rel="stylesheet" href="assets/styles.css?v=73">
```

Change `?v=73` to `?v=74`.

- [ ] **Step 4: Verify in browser**

1. With the dev server running, hard-refresh (Ctrl+Shift+R) at http://localhost:8787.
2. Confirm the old "SMASH PAIRING / Team assignment" header text is gone.
3. Confirm the home page shows new (unstyled) text: `// READY UP`, `Welcome to Smash Pairing`, `Add some players to get started`, plus a large unstyled Kirby SVG and two unstyled buttons labeled `Profiles` and `Schedule`.
4. Click `Profiles` — verify it opens the existing profiles screen.
5. Click the back arrow to return, then click `Schedule` — verify it opens the existing scheduling screen.

Expected: ugly but functional. Styling comes in Task 2.

- [ ] **Step 5: Commit (user runs)**

Suggested message:

```
home: add hero panel and hub navigation markup
```

---

## Task 2: Hero panel + hub button base styles

**Files:**
- Modify: `assets/styles.css` (append at end of file)
- Modify: `index.html` (bump styles.css cache-bust again)

- [ ] **Step 1: Append hero + hub styles**

Open `assets/styles.css` and append this entire block at the end of the file:

```css

/* ============================================================
   Home hero + hub
   Renders only on the home screen. Hides on profiles/schedule
   (via body[data-screen]) and on the results view (via #home
   being display:none when state.hasPaired).
   ============================================================ */

.home-hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px 22px 20px;
  min-height: 170px;
  margin: 0 auto 14px;
  max-width: 640px;
  background:
    radial-gradient(ellipse at 25% 30%, rgba(77, 159, 255, 0.28), transparent 60%),
    radial-gradient(ellipse at 80% 80%, rgba(46, 232, 160, 0.18), transparent 55%),
    linear-gradient(180deg, #13151c 0%, #0c0d10 100%);
}

.home-hero-eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--exp);
  text-transform: uppercase;
  margin-bottom: 6px;
  position: relative;
  z-index: 2;
}

.home-hero-headline {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 26px;
  line-height: 1;
  color: var(--text);
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  max-width: 65%;
  position: relative;
  z-index: 2;
}

.home-hero-stats {
  font-size: 12px;
  color: #7a8090;
  letter-spacing: 0.3px;
  position: relative;
  z-index: 2;
  max-width: 65%;
}

.home-hero-stats strong {
  color: var(--inexp);
  font-weight: 600;
}

.home-hero-mascot {
  position: absolute;
  right: -8px;
  bottom: -10px;
  width: 130px;
  height: 130px;
  z-index: 1;
  filter: drop-shadow(0 6px 20px rgba(255, 94, 133, 0.3));
  pointer-events: none;
}

/* Hub button strip ----------------------------------------- */

.home-hub {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 0 auto 16px;
  max-width: 640px;
}

.home-hub-btn {
  background: #13151c;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  font: inherit;
  transition:
    transform 0.2s cubic-bezier(.34, 1.56, .64, 1),
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.home-hub-btn:hover {
  transform: translateY(-2px) scale(1.02);
  border-color: var(--exp);
  box-shadow: 0 8px 20px -8px rgba(77, 159, 255, 0.5);
}

.home-hub-btn.is-green:hover {
  border-color: var(--inexp);
  box-shadow: 0 8px 20px -8px rgba(46, 232, 160, 0.5);
}

.home-hub-btn:active {
  transform: translateY(0) scale(0.98);
  transition-duration: 120ms;
}

.home-hub-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--exp-grad);
  border: 1px solid var(--exp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--exp);
  flex-shrink: 0;
}

.home-hub-btn.is-green .home-hub-icon {
  background: var(--inexp-grad);
  border-color: var(--inexp-border);
  color: var(--inexp);
}

.home-hub-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Bump styles.css cache-bust**

In `index.html`, change `?v=74` to `?v=75`.

- [ ] **Step 3: Verify in browser**

1. Hard-refresh.
2. Confirm the hero panel now has:
   - Dark gradient background with blue + green ambient glow
   - Cyan eyebrow text `// READY UP`
   - Large white headline `Welcome to Smash Pairing`
   - Subtitle in gray
   - Kirby positioned in the bottom-right corner
   - Hero is rounded, has a subtle border, ~170px tall
3. Confirm the hub now has two side-by-side buttons:
   - Profiles (blue icon)
   - Schedule (green icon)
4. Hover over each button — confirm it springs up slightly, border changes to its accent color, and a colored shadow appears below.
5. Click each button — confirm it depresses briefly, then navigates.

- [ ] **Step 4: Commit (user runs)**

Suggested message:

```
home: style hero panel and hub buttons
```

---

## Task 3: Entrance + ambient animations + reduced-motion fallback

**Files:**
- Modify: `assets/styles.css` (append at end of file)
- Modify: `index.html` (bump styles.css cache-bust)

- [ ] **Step 1: Append animation keyframes + sequenced delays**

Append to the end of `assets/styles.css`:

```css

/* ============================================================
   Home hero + hub: animations
   Entrance plays only when the .is-first-load class is on
   <html> (set by the JS first-load gate). Ambient animations
   (glow pulse, Kirby bob) always run while the home is visible.
   ============================================================ */

@keyframes home-hero-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes home-hero-glow {
  0%, 100% { box-shadow: inset 0 0 0 0 rgba(77, 159, 255, 0); }
  50%      { box-shadow: inset 0 0 40px 0 rgba(77, 159, 255, 0.08); }
}

@keyframes home-hero-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(-6px) rotate(2deg); }
}

/* Ambient: always on while home is visible. */
.home-hero {
  animation: home-hero-glow 6s ease-in-out infinite;
}

.home-hero-mascot {
  animation: home-hero-bob 4s ease-in-out infinite;
  transform-origin: center bottom;
}

/* Entrance: only when html.is-first-load is set. The JS removes
   that class after the first home render so re-entry from
   Profiles/Schedule doesn't re-animate. */
html.is-first-load .home-hero-eyebrow,
html.is-first-load .home-hero-headline,
html.is-first-load .home-hero-stats,
html.is-first-load .home-hero-mascot,
html.is-first-load .home-hub-btn {
  animation-fill-mode: both;
  animation-timing-function: cubic-bezier(.34, 1.56, .64, 1);
  animation-duration: 450ms;
  animation-name: home-hero-enter;
}

html.is-first-load .home-hero-eyebrow  { animation-delay: 50ms;  }
html.is-first-load .home-hero-headline { animation-delay: 150ms; }
html.is-first-load .home-hero-stats    { animation-delay: 250ms; }

/* Mascot: entrance, then ambient bob starts AFTER entrance completes
   (450ms duration + 350ms delay = 800ms, bob starts at 900ms). */
html.is-first-load .home-hero-mascot {
  animation:
    home-hero-enter 450ms 350ms cubic-bezier(.34, 1.56, .64, 1) both,
    home-hero-bob 4s 900ms ease-in-out infinite;
}

html.is-first-load .home-hub-btn:nth-child(1) { animation-delay: 400ms; }
html.is-first-load .home-hub-btn:nth-child(2) { animation-delay: 500ms; }

/* Reduced motion: strip everything. Hover keeps its color/border/
   shadow change but loses the spring. */
@media (prefers-reduced-motion: reduce) {
  .home-hero,
  .home-hero-mascot,
  html.is-first-load .home-hero-eyebrow,
  html.is-first-load .home-hero-headline,
  html.is-first-load .home-hero-stats,
  html.is-first-load .home-hero-mascot,
  html.is-first-load .home-hub-btn {
    animation: none !important;
  }
  .home-hub-btn {
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .home-hub-btn:hover {
    transform: none;
  }
  .home-hub-btn:active {
    transform: none;
  }
}
```

- [ ] **Step 2: Bump styles.css cache-bust**

In `index.html`, change `?v=75` to `?v=76`.

- [ ] **Step 3: Temporarily add `is-first-load` to test entrance**

For verification ONLY, temporarily add the class manually. Open browser DevTools console at http://localhost:8787 and run:

```js
document.documentElement.classList.add('is-first-load'); location.reload();
```

- [ ] **Step 4: Verify entrance animation**

After the reload:
1. Watch the home screen — eyebrow, headline, stats, Kirby, and the two hub buttons should fade-and-spring in over ~700ms, in that order.
2. After the entrance completes, Kirby should bob gently up/down with a slight rotation.
3. The hero panel background should slowly pulse a subtle blue glow (6s loop). Look closely — it's intentionally subtle.

- [ ] **Step 5: Verify reduced-motion fallback**

In DevTools:
1. Open the Rendering tab (more tools menu → Rendering).
2. Find "Emulate CSS media feature prefers-reduced-motion" and set it to `reduce`.
3. Hard-refresh the page.
4. Confirm: no entrance animation, no Kirby bob, no glow pulse, no spring on button hover. Hovering a button still changes its border color + adds shadow.
5. Reset the emulation to `no-preference`.

- [ ] **Step 6: Clean up the manual test class**

In DevTools console:

```js
document.documentElement.classList.remove('is-first-load');
```

(Task 4 will set this class automatically from JS.)

- [ ] **Step 7: Commit (user runs)**

Suggested message:

```
home: hero entrance, ambient, and reduced-motion animations
```

---

## Task 4: renderHero() — live stats and auth-aware headline

**Files:**
- Modify: `assets/app.js` (add `renderHero()` function, call from `render()`, also call from `refreshAuthUi`)
- Modify: `index.html` (bump app.js cache-bust)

- [ ] **Step 1: Add the `renderHero()` function**

Find this block in `assets/app.js` around line 567:

```js
function render() {
  document.getElementById('home').style.display     = state.hasPaired ? 'none' : 'block';
  document.getElementById('menu-btn').style.display = state.hasPaired ? 'none' : 'flex';
  document.body.dataset.screen =
    currentScreen === 'profiles' ? 'profiles' :
    currentScreen === 'schedule' ? 'schedule' :
    (state.hasPaired ? 'results' : 'home');
  renderMenu();
  renderPanel('exp');
  renderPanel('inexp');
  renderFixedList();
  renderGenBtn();
  renderResults();
}
```

Immediately ABOVE that function, insert:

```js
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
    return;
  }

  stats.innerHTML =
    `<strong>${playerCount}</strong> ${playerCount === 1 ? 'player' : 'players'} ` +
    `&middot; <strong>${presetCount}</strong> ${presetCount === 1 ? 'preset' : 'presets'} ` +
    `&middot; <strong>${profileCount}</strong> ${profileCount === 1 ? 'profile' : 'profiles'}`;
}
```

- [ ] **Step 2: Call `renderHero()` from `render()`**

In the same `render()` function, add a call to `renderHero()` as the first statement after the existing `document.body.dataset.screen = ...` assignment, before `renderMenu()`:

```js
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
```

- [ ] **Step 3: Re-render hero on auth change**

Find the `refreshAuthUi` function in `assets/app.js`:

```js
function refreshAuthUi(user) {
  const signOutBtn = document.getElementById('menu-signout');
  const signOutDesc = document.getElementById('menu-signout-desc');
  if (signOutBtn) signOutBtn.hidden = !user;
  if (signOutDesc && user && user.username) {
    signOutDesc.textContent = `Signed in as @${user.username}`;
  }
}
```

Add a call to `renderHero()` at the end of the function:

```js
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
```

- [ ] **Step 4: Bump app.js cache-bust**

In `index.html`, find:

```html
<script src="assets/app.js?v=72"></script>
```

Change `?v=72` to `?v=73`.

- [ ] **Step 5: Verify live updates in browser**

1. Hard-refresh at http://localhost:8787.
2. Confirm headline now reads `Welcome back, @<your-username>` (instead of generic "Welcome to Smash Pairing").
3. If you have no players/presets/profiles, the stats line reads `Add some players to get started`.
4. Type a name into the Experienced input and click `+`. Confirm the stats line updates to `1 player · 0 presets · 0 profiles`.
5. Add a second exp player. Confirm `2 players · ...`.
6. Add an inexp player. Confirm `3 players · ...`.
7. Open the Presets modal (Presets button) and save the current roster as a preset. Close the modal. Confirm `... · 1 preset · ...`.
8. Open the menu → Profiles → create a profile (or just visit). Return home. Confirm profile count updated.

- [ ] **Step 6: Commit (user runs)**

Suggested message:

```
home: renderHero with live stats and auth-aware greeting
```

---

## Task 5: First-load animation gate (sessionStorage)

**Files:**
- Modify: `index.html` (inline head script — extend the existing splash-skip block)
- Modify: `assets/app.js` (remove the `is-first-load` class once the first home render completes)
- Modify: `index.html` (bump cache-busts for both)

- [ ] **Step 1: Set the `is-first-load` class in the inline head script**

Find this existing block in `index.html` (around lines 33-44):

```html
<script>
    // Show the splash at most once per browsing session. A service-worker
    // ...
    (function () {
      try {
        if (sessionStorage.getItem('tp_splash_shown') === '1') {
          document.documentElement.classList.add('splash-skip');
        } else {
          sessionStorage.setItem('tp_splash_shown', '1');
          document.documentElement.classList.add('splash-showing');
```

Inside the same `try` block, ABOVE the existing `if (sessionStorage.getItem('tp_splash_shown')` line, add a sibling check for the hero-animated flag:

```js
        // Same one-shot-per-session pattern as the splash above. When the
        // flag is absent, we add html.is-first-load and the hero's CSS
        // entrance animation plays. JS removes the class after the first
        // home render so re-entering home from another screen doesn't
        // re-trigger it.
        if (sessionStorage.getItem('tp_hero_animated') !== '1') {
          document.documentElement.classList.add('is-first-load');
        }

```

The completed block should look like:

```js
    (function () {
      try {
        if (sessionStorage.getItem('tp_hero_animated') !== '1') {
          document.documentElement.classList.add('is-first-load');
        }
        if (sessionStorage.getItem('tp_splash_shown') === '1') {
          document.documentElement.classList.add('splash-skip');
        } else {
          sessionStorage.setItem('tp_splash_shown', '1');
          document.documentElement.classList.add('splash-showing');
```

- [ ] **Step 2: Clear the class after the first home render**

In `assets/app.js`, find the `renderHero()` function added in Task 4. At the very end of the function (after the stats are rendered), add:

```js
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
```

The final function should look like:

```js
function renderHero() {
  const headline = document.getElementById('home-hero-headline');
  const stats    = document.getElementById('home-hero-stats');
  if (!headline || !stats) return;

  const user = (window.SmashSync && window.SmashSync.getCurrentUser)
    ? window.SmashSync.getCurrentUser()
    : null;
  const name = user && (user.username || (user.email ? user.email.split('@')[0] : null));
  headline.textContent = name
    ? `Welcome back, @${name}`
    : 'Welcome to Smash Pairing';

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

  if (document.documentElement.classList.contains('is-first-load')
      && sessionStorage.getItem('tp_hero_animated') !== '1') {
    sessionStorage.setItem('tp_hero_animated', '1');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('is-first-load');
    }));
  }
}
```

- [ ] **Step 3: Bump cache-busts**

In `index.html`:
- Change `assets/styles.css?v=76` to `?v=77` (Task 3 was 76; this is the first index.html change after that)
- Change `assets/app.js?v=73` to `?v=74`

(If your cache-bust numbers differ because you skipped a task or merged commits, increment whatever the current value is by 1.)

- [ ] **Step 4: Verify the first-load animation**

1. Close the browser tab entirely.
2. Reopen http://localhost:8787 in a new tab.
3. Confirm the splash plays once, then the hero/hub fade-and-spring in sequenced.
4. Navigate to Profiles (click Profiles button), then return to Home (back arrow).
5. Confirm the hero/hub appears INSTANTLY with no entrance animation — Kirby still bobs (ambient), glow still pulses (ambient), but no fade-up.
6. Refresh the page (Ctrl+R, not Ctrl+Shift+R). Same tab session.
7. Confirm the hero/hub still appears INSTANTLY — sessionStorage persisted across the refresh.
8. Close the tab and reopen. New page session. Entrance animation plays again.

- [ ] **Step 5: Commit (user runs)**

Suggested message:

```
home: gate hero entrance animation behind first-load sessionStorage flag
```

---

## Task 6: Service worker cache bump + final verification

**Files:**
- Modify: `service-worker.js` (bump `CACHE` constant)

- [ ] **Step 1: Bump the SW cache version**

Open `service-worker.js`, find:

```js
const CACHE = 'rpg-runtime-v78';
```

(Or whatever the current `v78`+ number is — bump by 1.)

Change to the next number:

```js
const CACHE = 'rpg-runtime-v79';
```

- [ ] **Step 2: Verify the service worker picks up the new bundle**

1. Open DevTools → Application → Service Workers.
2. Click "Update" next to the active worker.
3. Confirm the SW status shows "activated" with the new version.
4. Hard-refresh.
5. Confirm everything from Tasks 1-5 still works end-to-end:
   - Hero shows with greeting + stats
   - Kirby bobs
   - Hub buttons spring on hover
   - Profiles + Schedule buttons navigate
   - Adding/removing players updates the stats line
   - Entrance animation plays once per page session
   - `prefers-reduced-motion: reduce` strips everything

- [ ] **Step 3: Test on phone (optional but recommended)**

1. From a phone on the same Wi-Fi as your PC, find your PC's local IP (Settings → Network in Windows, or `ipconfig` in PowerShell).
2. On your phone's browser, visit `http://<PC-IP>:8787`.
3. Confirm the hero panel renders correctly, Kirby is positioned cleanly, and hub buttons are comfortably tappable.

Note: if the connection is refused, the local dev server may only be bound to `localhost`. That's expected; this is just a polish-pass check, not required.

- [ ] **Step 4: Commit (user runs)**

Suggested message:

```
sw: bump cache to ship home hero + hub
```

---

## Self-review notes

**Spec coverage check:**
- Architecture (hero + hub stacked above pairing workspace): Task 1 (markup) + Task 2 (styles).
- Hero content slots (eyebrow, headline, stats, mascot): Tasks 1, 2, 4.
- Edge cases (fresh account, singular/plural, missing username): Task 4.
- Hero sizing + background: Task 2.
- Hub button anatomy (icon-pill + label, two definitions): Tasks 1, 2.
- Hover/tap/accessibility: Task 2 + Task 3 (reduced-motion).
- Animation entrance sequence + delays: Task 3.
- Ambient (glow pulse + Kirby bob): Task 3.
- Reduced-motion fallback: Task 3.
- First-load gate (sessionStorage): Task 5.
- Live data updates + auth listener: Task 4.
- Files touched (index.html, styles.css, app.js, service-worker.js, cache-busts): all covered across tasks.
- Out-of-scope items (last session date, time-of-day greeting, etc.): correctly excluded.

**Type/name consistency check:**
- `renderHero()` defined in Task 4, called in Task 4 (from `render` and `refreshAuthUi`), extended in Task 5. Consistent.
- Element IDs (`home-hero`, `home-hero-headline`, `home-hero-stats`, `home-hero-mascot`) used identically in Task 1 markup, Task 2 styles, Task 4 JS.
- Class names (`home-hero`, `home-hero-eyebrow`, `home-hero-headline`, `home-hero-stats`, `home-hero-mascot`, `home-hub`, `home-hub-btn`, `home-hub-icon`, `home-hub-label`, `is-green`, `is-first-load`) used identically in markup, styles, and animation rules.
- SessionStorage keys: `tp_splash_shown` (existing, untouched) and `tp_hero_animated` (new). Documented in both Task 5 head-script and Task 5 JS gate.

No placeholders. No "TBD" / "add similar". Every code step contains complete code.
