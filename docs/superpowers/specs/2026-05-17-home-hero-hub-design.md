# Home Hero + Hub — Design Spec

**Date:** 2026-05-17
**Author:** Claude + Parker (brainstorming session)
**Status:** Approved, ready for implementation plan

## Summary

Add a cinematic hero panel and a two-button navigation hub to the top of the home screen. The existing pairing workspace (player lists, Set Teams, Generate) stays untouched below. Result: an app home page that feels like a real product, not a workspace, while keeping the most-used flow one tap away.

## Why

Today the home screen is the pairing workspace itself — there's no actual landing experience. Profiles and Scheduling live behind the hamburger menu, which is a friction tax for the two highest-value secondary destinations. A hero + hub gives the app a real first-impression surface and brings the two secondary destinations to within one tap.

## Architectural shape

The home view (`#home` div) grows two new regions stacked above the existing workspace:

```
#home
├── HERO PANEL                  (new)
│   ├── eyebrow text
│   ├── headline (greeting)
│   ├── stats line
│   └── Kirby mascot (SVG)
├── HUB BUTTONS                 (new)
│   ├── Profiles
│   └── Schedule
└── PAIRING WORKSPACE           (unchanged)
    ├── Presets button
    ├── Experienced panel
    ├── Inexperienced panel
    ├── Set Teams panel
    └── Generate Teams button
```

### Scope rules

- Hero + Hub render **only when `currentScreen === 'home'`**. Profiles, Schedule, and Results take over the viewport exactly as today — they get nothing new.
- The hamburger menu stays. It continues to hold Team Creation mode, Options, How to play, About, Export/Import, Reset, Sign out. The hub is for nav-by-tap, the hamburger is for settings and admin.
- The existing `<header>` ("SMASH PAIRING / Team assignment") is removed — the hero replaces its purpose.

## Hero panel

### Content slots

| Slot | Default text | Source |
|---|---|---|
| Eyebrow | `// READY UP` | static |
| Headline | `Welcome back, @{username}` | `SmashSync.getCurrentUser().username` |
| Stats line | `{n} players · {m} presets · {p} profiles` | live from `state`, `presets`, `profiles` |
| Mascot | Kirby SVG, bottom-right, ~110px | reused from splash markup |

### Edge cases

- **Fresh account (0 players, 0 presets, 0 profiles):** stats line replaced by `Add some players to get started`.
- **Singular vs plural:** `1 player` vs `2 players`. Same for presets/profiles.
- **Username metadata missing:** fallback to email local-part (already implemented in `userFromSession`).
- **Not logged in (config blank, app in pure-local mode):** headline becomes `Welcome to Smash Pairing` (no `@username`). Hero still renders.

### Sizing

- Min-height: 170px (enough room for the mascot without crowding text).
- Max-width: 640px (matches the rest of the home content).
- Internal padding: 24px top/sides, 20px bottom.

### Background

Layered gradients over the dark base:

```css
background:
  radial-gradient(ellipse at 25% 30%, rgba(77, 159, 255, 0.28), transparent 60%),
  radial-gradient(ellipse at 80% 80%, rgba(46, 232, 160, 0.18), transparent 55%),
  linear-gradient(180deg, #13151c 0%, #0c0d10 100%);
```

Ambient pulse animates inset glow (see Animations).

### Mascot

Reuses the splash Kirby SVG, cloned into the hero with all gradient IDs renamed (`sp-` → `hero-`) to avoid collision. Scaled to 110×110, absolutely positioned at `right: -8px; bottom: -10px` with `filter: drop-shadow(0 6px 20px rgba(255, 94, 133, 0.3))`. Bobs gently (see Animations).

## Hub buttons

### Layout

Two buttons, side by side, equal width, 8px gap, 12px below the hero.

### Anatomy

```
┌───────────────────────────────┐
│ ▣ icon-pill   PROFILES        │
└───────────────────────────────┘
```

- **Icon pill** — 28×28px rounded square (`border-radius: 8px`), gradient background matching the accent color, 16px stroked SVG centered inside.
- **Label** — Barlow Condensed 700, 14px, uppercase, 0.5px letter-spacing.

### Definitions

| Button | Icon | Accent | Click handler |
|---|---|---|---|
| Profiles | person + curve (existing SVG from menu) | exp blue `#4d9fff` | `openProfilesScreen()` |
| Schedule | calendar (existing SVG from menu) | inexp green `#2ee8a0` | `openScheduleScreen()` |

### Base style

- Background `#13151c`
- Border 1px `#1f2130`
- Border-radius 10px
- Padding 12px
- Display flex, align-items center, gap 10px
- Min-height 52px (comfortable tap target)

### Hover state (Polished)

- `transform: translateY(-2px) scale(1.02)` with `cubic-bezier(.34, 1.56, .64, 1)` (overshoot)
- Border color → accent (blue or green)
- Box-shadow: `0 8px 20px -8px rgba(<accent>, 0.5)`
- All transitions 200ms

### Tap state

- Scale to `0.98` then back, 120ms.

### Accessibility

- Real `<button>` elements with `aria-label`.
- `prefers-reduced-motion`: drops the spring, keeps the color change.

## Animations (Polished package)

### Entrance sequence

Plays **only on first load per page session**, controlled by a `sessionStorage` flag (same pattern as the existing splash-skip flag). Returning to home from another screen shows everything instantly.

All elements share base keyframes:

```css
@keyframes hero-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Easing: `cubic-bezier(.34, 1.56, .64, 1)` (spring overshoot). Duration 450ms.

| Element | Delay |
|---|---|
| Eyebrow | 50ms |
| Headline | 150ms |
| Stats | 250ms |
| Kirby | 350ms |
| Profiles button | 400ms |
| Schedule button | 500ms |

Kirby's bob animation starts at 900ms (after entrance completes).

### Ambient (always running while home is visible)

- **Hero glow pulse:** `inset 0 0 40px 0 rgba(77, 159, 255, 0.08)` fades in/out over 6s.
- **Kirby bob:** `translateY(0 → -6px) rotate(-2deg → 2deg)` over 4s, infinite.

### Interaction

- Hub button hover/tap: described in Hub buttons section above.

### Reduced motion

When `(prefers-reduced-motion: reduce)`:
- All entrance, hover-spring, Kirby-bob, and glow-pulse animations stripped.
- Hub buttons keep color/border change on hover but lose the spring.

## Live data

The hero stats line re-renders whenever the user mutates state. Folded into the existing `render()` call chain via a new `renderHero()` helper. The helper reads:
- `state.exp.length + state.inexp.length` for player count
- `presets.length` for preset count
- `profiles.length` for profile count

`renderHero()` also updates the headline when auth state changes (subscribed via the existing `SmashSync.onAuthChange`).

## Implementation surface

| File | Change |
|---|---|
| `index.html` | Remove `<header>`. Replace top of `#home` (before `.home-actions`) with hero + hub markup. Bump `styles.css` and `app.js` cache-busts. |
| `assets/styles.css` | Append hero + hub + animation rules (~300 lines). Place under a `/* ---- Home hero + hub ---- */` section header. |
| `assets/app.js` | New `renderHero()` function. Call it from inside the existing `render()` for home. Add sessionStorage flag for first-load animation. Add `SmashSync.onAuthChange` listener if not already present (it is, via login wiring). |
| `service-worker.js` | Bump `CACHE` to next version. |

No new dependencies. No new screens. No data model changes.

## Out of scope

Explicitly deferred to keep this implementation focused:

- Tracking "last session date" or any other new persisted data.
- Time-of-day greeting variants ("Good morning" etc.).
- Animated background gradient that responds to time of day.
- Personalized headline variants based on player count or recent activity.
- Mascot personality (idle reactions, hover responses).
- Quick-actions like "Pair last roster" or "Continue where you left off."

These are all easy to add later if wanted, but each pulls the scope out further than this iteration needs.

## Success criteria

- Opening the app to the home screen presents a hero panel, hub buttons, and the pairing workspace in that vertical order.
- Profiles and Schedule are reachable in one tap from home without opening the hamburger.
- Entrance animation plays once per page session; subsequent home views don't re-animate.
- Stats line updates live as the user adds/removes players, presets, or profiles.
- Users with `prefers-reduced-motion` see the hero/hub appear instantly with no animation; hover is color-only.
- Existing functionality (Presets, player input, Set Teams, Generate, Results, Profiles, Schedule, menu, Sign out) is untouched.
