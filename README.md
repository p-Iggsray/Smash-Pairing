<p align="center">
  <img src="assets/readme-hero.svg" alt="READY? — GO!" width="720">
</p>

# Smash Pairing

<p align="center"><em>Random 2v2 team generator for <strong>Super Smash Bros Ultimate</strong>. Roster, profiles, scheduling, and bracket export, all in one PWA. Drops a thirty-minute setup ritual to under five.</em></p>

<p align="center">
  <a href="https://smash-pairing.priggs32304.workers.dev/">
    <img src="https://img.shields.io/badge/Play%20Now-Live%20Demo-e8442e?style=for-the-badge&labelColor=1a0a14" alt="Play Now">
  </a>
  <img src="https://img.shields.io/badge/PWA-Installable-4d9fff?style=for-the-badge&labelColor=1a0a14" alt="PWA">
  <img src="https://img.shields.io/badge/Sync-Supabase-2ee8a0?style=for-the-badge&labelColor=1a0a14" alt="Supabase Sync">
  <img src="https://img.shields.io/badge/Stack-HTML%20%2B%20CSS%20%2B%20JS-ffc94d?style=for-the-badge&labelColor=1a0a14" alt="Stack">
</p>

A few of us run friendly Smash sets every now and then. Before this, team picking was just guessing, and somebody always ended up paired badly. The fix is two columns of names in (skilled / less skilled), balanced teams out, named and pasted into Challonge before the first match starts. Now it also tracks who's coming, when they're free, and remembers all of it across every device you sign in on.

Installable. Works offline. One login, everywhere.

---

## How to Play

The home screen has three regions stacked top to bottom: a **hero panel** with your stats, a **hub** of quick-nav buttons to Profiles and Schedule, and the **pairing workspace** itself. Everything else is one tap away.

● **Stock 1 — Roster.** On the Home screen, add players into two columns: **Experienced** and **Inexperienced.** Tap a name to rename. Tap × to remove. Got the list typed out somewhere already? The bulk-add takes a whole batch from a paste.

● **Stock 2 — Mode.** Hamburger top-right. Pick **Full 2v2** (one exp + one inex per team — default) or **Split 2v2** (same-skill teams).

● **Stock 3 — Generate.** Big button at the bottom. Confetti. Numbered team cards on the Results screen.

● **Stock 4 — Names. Or skip.** Tap the dashed line above any team to give it a name. Skip it and you get Team 01, Team 02, Team 03.

● **Stock 5 — Export.** Hit **Export for Challonge.** Bottom sheet opens with one team per line. Copy. Paste into Challonge's bracket builder. Bracket's seeded.

**GAME!**

### Mode select

```
╔══════════════════════════╦══════════════════════════╗
║         FULL 2v2         ║        SPLIT 2v2         ║
║                          ║                          ║
║      exp  +  inex        ║      exp  +  exp         ║
║       (every team)       ║      inex +  inex        ║
║                          ║                          ║
║   Mixed skill on every   ║   Same-skill pairs.      ║
║   team. No team gets     ║   For when you want a    ║
║   stacked. Default.      ║   tier-vs-tier bracket.  ║
╚══════════════════════════╩══════════════════════════╝
```

Full 2v2 is the reason the app exists. Stops you from putting two strong players on one team and the two weaker ones on another. Split 2v2 is there for when you want the opposite.

### Set Teams

The **Set Teams** panel on the Home screen locks specific pairs that always play together. They get a card on Results just like the random pairs, just without the swap behavior. Useful when two people in the group always duo, or when a new guy is shadowing someone who knows the matchups.

---

## Beyond Pairing

The hub has two more screens for the meta-game around sessions.

### Profiles

Per-player records that outlive the current roster. From the hub or the menu:

● Set each player's main fighter from the full **87-character SSBU roster** (canonical CSS order)
● Score **attendance** 1–10 — used as a tiebreaker by the scheduler when ranking best slots
● Log **shifts** (work, class, anything blocking) per profile so you don't have to remember who's busy when

Past-dated shifts auto-purge so yesterday's work shift doesn't pollute tomorrow's heatmap.

### Scheduling

Pick the date range you care about, get a **heatmap** of when the group is collectively free. Each cell is colored by how many people are available at that hour. Tap a cell to see exactly who. The app also ranks the **best slots** based on availability + attendance score, so you can pick the night that gets the most of your strongest crew together.

---

## Cross-Device Sync

Sign in once, get your full state (roster, presets, profiles, schedule) on any device. The home screen on your phone shows the same data as the home screen on your PC, in real time after a refresh.

How it works:

● **Local-first.** `localStorage` is still the source of truth at runtime. The app keeps working offline exactly like before.
● **Cloud mirror.** Every save also pushes to your Supabase row (debounced ~1s). Per-key timestamps decide who wins when two devices have different versions.
● **Sign-in only.** Account creation is closed — the maintainer made one account, then disabled signups in Supabase. Forking gives you your own Supabase project and your own login.
● **Row-Level Security** keeps every account's data isolated. Even with the anon key public, no user can read or write anyone else's data.

The login lives behind a Kirby-fronted card that matches the home hero's palette. Sign out from `Menu → Options → Sign out`.

---

## Move List

### Standard Moves

● Skill-balanced random pairing in Full 2v2 — never two experienced or two inexperienced on the same team
● Split 2v2 mode for tiered brackets
● **Set Teams** to lock specific pairs out of the shuffle
● Late arrivals — add a player after generating, hit **Pair Waiting**, they form the next team
● Player swap — tap two players on Results to swap them between teams
● Custom team names that flow straight into the Challonge export
● **Presets** — save and reload named rosters so a recurring crew doesn't get re-entered every time
● Two-tap **Reset Teams** wipes pairings without touching the rosters
● Auto-save to `localStorage` — force-quit the app, your lists are still there
● **Export / Import** the entire data set as JSON for hand-rolled backups

### Special Moves

● **Cinematic home hero** with a Kirby mascot, live stats (players · presets · profiles), and a sequenced entrance animation
● **Hub buttons** for Profiles and Schedule, one tap from home
● Splash screen with a custom Kirby-shaped icon (matches the login + hero)
● Confetti on Generate (respects `prefers-reduced-motion`)
● Pulse animations on the Generate button, editable team-name underlines, and the swap-selected player
● Per-column accents — exp blue, inex green, set gold — carried through buttons, chips, and member dots
● Stencil team numbers on each Results card
● Inline name editing — tap any name to rename in place

### Final Smash

● **Cross-device sync** via Supabase — sign in on phone + PC, work continues wherever you are
● Installable as a PWA — adds to the iPhone Home Screen, runs full-bleed
● Offline once installed (sync catches up on reconnect)
● Auto-updates on every launch via the service worker. No App Store, no manual cache-clear
● Built for iPhone — safe-area insets for the Dynamic Island and home indicator, no iOS auto-zoom on text inputs, no horizontal scroll on small phones
● Full `prefers-reduced-motion` support — all entrance/hover springs strip when requested

---

## Add to Roster

Install on iPhone:

1. Open the **[live demo](https://smash-pairing.priggs32304.workers.dev/)** in **Safari.** iOS doesn't let Chrome or Firefox install PWAs.
2. Tap the **Share** button.
3. Choose **Add to Home Screen.**
4. Icon shows up labeled **Smash Pairing.**
5. Open it from the Home Screen and sign in once. Done.

It runs like a native app from there — no browser chrome, no URL bar.

---

## Training Mode

No build step. The `dev.bat` launcher in the repo root is the fast path on Windows:

```bash
# Windows — one click in Explorer, or:
.\dev.bat
```

What it does: starts `npx serve` on port 8787 and opens your browser. First run downloads `serve` once (~5MB, cached after). All saves you make hit your real Supabase, so changes show up on your phone after a refresh.

If you're not on Windows, anything that serves static files works:

```bash
python3 -m http.server 8000
# or
npx serve -l 8000 .
```

Then open `http://localhost:8000`.

### Folder layout

```
.
├── index.html
├── service-worker.js
├── manifest.webmanifest
├── dev.bat                       # local dev launcher (Windows)
├── wrangler.jsonc                # Cloudflare Workers config (static assets only)
├── supabase/
│   └── schema.sql                # run this once in your Supabase SQL editor
├── assets/
│   ├── app.js                    # all app logic (~3000 lines, single file)
│   ├── styles.css                # all styles
│   ├── theme.css                 # CSS custom properties
│   ├── supabase-config.js        # fill in your Project URL + anon key
│   ├── supabase-client.js        # auth + sync wrapper
│   ├── fighters/                 # SSBU fighter icons
│   ├── icon.svg
│   └── readme-hero.svg
└── docs/superpowers/             # specs + plans for big features
```

---

## Fork it

Want your own instance? You'll need your own Supabase project and any static host.

### 1. Supabase setup

1. Create a new project at [supabase.com](https://supabase.com). Free tier is plenty.
2. **SQL Editor → New query** → paste `supabase/schema.sql` from this repo → **Run**. Creates the `user_data` table + RLS policies.
3. **Authentication → Sign In / Up → Email** → turn off **"Confirm email"** (optional; only needed if you don't want to verify your address).
4. **Settings → API** → copy the **Project URL** and the **publishable** (a.k.a. `anon`) key.
5. Open `assets/supabase-config.js` and paste those two values in.
6. Open the app, click **Sign In** → use your email + a password. Create your account.
7. **Authentication → Sign In / Up** → turn off **"Allow new users to sign up"**. From now on, only your account can ever exist in this project.

### 2. Deploy

Anything that serves static files works. The repo ships with `wrangler.jsonc` for Cloudflare Workers:

```bash
npx wrangler deploy
```

Or push to Netlify / Vercel / GitHub Pages / your own server. There's no build step.

> [!IMPORTANT]
> The Supabase **anon key** is designed to be public — it ships in the deployed JS bundle and is visible in any browser's devtools. Row-Level Security is what protects your data. Never commit the **`service_role` / `sb_secret_*`** key; it bypasses RLS.

---

## Specs

- **Frontend:** Plain HTML, CSS, JavaScript. No frameworks, no bundler.
- **Data:** `localStorage` as runtime source of truth, mirrored to Supabase per-key when signed in.
- **Auth:** Supabase Auth (email + password). Sign-in only — signups are disabled in the project.
- **Service worker:** network-first with cache fallback. New deploys reach installed PWAs within seconds.
- **Hosting:** Cloudflare Workers serving static assets (`wrangler.jsonc`).

---

## Maintainer

Quick links for the project owner (`@p-Iggsray`):

- [Cloudflare Worker — production](https://dash.cloudflare.com/3a6281976c615b69805a0133ae2c1fae/workers/services/view/smash-pairing/production)
- [Supabase project dashboard](https://supabase.com/dashboard/project/dnphmjkueburcvhhwokr)
- [Design specs + implementation plans](docs/superpowers/)

---

## Why this exists

A few of us play Smash Ultimate every now and then. We needed a way to actually balance the teams instead of stacking all the skilled players on one side. Doing it by hand took thirty minutes and someone always got the short end.

This brought it under five. Then it grew — profiles, scheduling, sync — because the same people kept saying "wait when are we playing again?" and "did anyone bring a list?" If your group runs the same kind of thing, fork it and it's all yours.
