# Stak v3 — intent-aware AI app builder

Describe what you want in English or Hinglish. Stak works out **what kind of thing** you meant (app, tool, game or website), asks a few short questions, then builds it, tests it, repairs it and publishes it with a real backend: database, sign-in, AI and server-side API keys.

> "ek AI chatbot bana" opens a working chat screen, not a marketing page about a chatbot.

## What makes it different

| | What Stak does |
|---|---|
| **Production templates** | AI chatbots, trackers/dashboards (expenses, habits, inventory, leads…) and business websites start from hand-built, fully working templates (`server/templates/`). The model writes only a small JSON config — names, colours, fields, categories, copy, sample data — so you get a SaaS-grade UI in 3–8 s instead of a one-shot page with broken parts. Anything else still uses free generation. |
| **Intent engine** | Rule-based classifier (`server/intent.js`) plus kind-specific build profiles. The checks in `site.js#intentIssues` reject a landing page when you asked for an app, and also catch a chatbot that never calls the AI, a tool with no input handlers, or a sign-in wall you didn't ask for. |
| **Speed** | Groq models first (typical build is 20–30 s on GPT-OSS 120B), with automatic, health-checked fallback to NVIDIA NIM or any OpenAI-compatible endpoint. |
| **Honest QA** | Every build gets: syntax and runtime checks, a DOM-reference check (ids the JS uses but the HTML lacks), a CDN-build fixer, an AI acceptance review against the blueprint's checks, a security scan (A–F), up to `STAK_REPAIR_ROUNDS` repairs, and a re-check that **updates the pass counts honestly** after repair. |
| **Real backend** | `stak.js` SDK: `stak.db` with server-enforced rules (`stak.rules.json`), server-side starter data (`stak.seed.json`), `stak.auth`, `stak.ai.chat` streaming, `stak.fetch` with encrypted `{{SECRETS}}` that never reach the browser, plus live web search. |
| **Visual select-edit** | Click any element in the preview, then describe the change. The selector and HTML go to the edit model. |
| **Preview-as-admin** | The builder gets a scoped, 2-hour preview token, so admin screens work in the preview without making a test account. |
| **Versions** | Every build and edit is a version you can restore. Edits use SEARCH/REPLACE patches with a regression guard. |
| **No lock-in** | Download a ZIP of plain HTML/CSS/JS and host it anywhere. |
| **Real photos** | Wikimedia Commons photos with licence and author credits. No random stock, no fake placeholders. |
| **Open and BYOK** | MIT licensed and self-hostable: bring your own Groq or NVIDIA key. Each build reports its token usage. |

## Layout

```
server/        Express API + engine
  index.js     routes, auth, rate limits, Stak Cloud (/api/rt), preview, zip
  jobs.js      questions → blueprint → research → build → QA/repair ∥ photos → review → re-check → publish
  llm.js       model catalog, presets (Pro/Think/Fast), fallback chains, health, 429 handling, output validation
  site.js      file/patch parsing, verify + auto-fix, runtime/DOM checks, intent checks, rules, seed, preview agent
  intent.js    app / tool / game / site classifier
  security.js  per-build security scan + grade
  prompts.js   all system prompts
  images.js    Wikimedia photo search with credits
  search.js    live web search (Groq browser search → Tavily → Brave → Serper → DuckDuckGo/Wikipedia)
  runtime/     stak.js SDK, stak-ui.css/js design kit, stak-motion.js
client/        React + Vite + Tailwind + shadcn UI (builds into public/)
tests/         node:test unit tests for the deterministic engine
docs/          architecture, security model, API
legacy/        the v2 prebuilt bundle, kept for reference
```

## Run locally

```bash
npm ci
cp .env.example .env            # set STAK_SECRET and GROQ_API_KEY and/or NVIDIA_API_KEY
npm run build:all               # builds the React client into public/
node --env-file=.env server/index.js   # http://localhost:5000
npm test                        # engine unit tests
```

For client development, run `cd client && npm run dev`. This starts Vite on 5173 and proxies `/api` to 5000.

## Deploy

- **Docker:** `docker compose up -d --build`. Data lives in the `stak-data` volume.
- **Render:** create a new Blueprint. It reads `render.yaml` (Docker, 1 GB disk at `/data`). Then set the API keys.
- Run a **single instance**: SQLite plus an in-memory job queue. The health check is `GET /api/health`.

## Known limits (honest)

- **Free Groq keys** allow about 8k tokens per minute. Two builds at the same time hit 429 errors, and Stak falls back to slower models, so a build can take 60–120 s instead of about 25 s. A paid Groq tier removes this.
- Generated apps are single-page HTML/CSS/JS (no React or npm packages inside the generated app). This keeps previews instant and exports portable, but it limits very large apps.
- QA is static and simulated, not a full headless browser run. It catches the most common breakages (syntax, undefined names, missing DOM ids, CommonJS CDN builds, intent mismatch). Some visual and logic bugs still reach review.
- Template apps (chat, tracker) store data in the browser (localStorage) on each device; there is no cloud sync yet. Website leads do go to `stak.db`.
- Template UI labels are English by default; content (names, prompts, categories) follows your language.
- Wikimedia photo search is keyword based and sometimes picks an off-topic photo. Upload your own photos in the questions step for the best result.
- One server instance only. Horizontal scaling needs Postgres and a shared queue.

See `docs/` for the architecture, security model and API reference.

## Live app, PWA and Android

- Live: https://stak-ai.pplx.app (web + installable PWA: browser menu → "Install app" / "Add to Home screen").
- Real-time: the UI polls `/api/mobile/summary` + `/api/mobile/events` every 3 s (20 s in background) and shows a floating live tracker, toasts, and system notifications. Web Push (VAPID) delivers "build ready / needs answers / failed" even when the tab is closed — tap the bell in the top bar to enable it.
- Android app (`mobile/`): Capacitor shell that loads the live site, plus native code in `mobile/android/app/src/main/java/app/stak/builder/`:
  - `StakWidget` — 2x2 resizable home-screen widget: live build phase, progress bar and timer, current/latest project, building/ready/ask counts, last event, refresh button.
  - `LiveService` — foreground "live tracking" notification that updates every 3 s while a build runs and stops itself afterwards.
  - `SyncWorker` — WorkManager background sync every 15 min (Android minimum) that posts notifications and refreshes the widget when the app is closed.
  - `StakNativePlugin` — JS bridge (`window.Capacitor.Plugins.StakNative`) used by the web app to hand over the session and summary.
- Download the APK from [Releases](../../releases). Build it yourself: `cd mobile && npm install && npx cap sync android && cd android && ./gradlew assembleDebug` (JDK 21 + Android SDK 35). Release signing reads `STAK_KEYSTORE`, `STAK_KEYSTORE_PASSWORD`, `STAK_KEY_ALIAS`, `STAK_KEY_PASSWORD` from the environment; the keystore is never committed.

### Testing checklist

1. Web: open the live URL → type a prompt → answer the questions → watch steps → open preview, test the app (add data, AI chat), download ZIP.
2. Live tracker: start a build, go back to Home → the floating pill shows phase, % and timer; a toast appears when it's ready.
3. Notifications: tap the bell → allow → start a build → switch tab / close it → system notification arrives.
4. Android: install the APK (allow "install unknown apps"), open it, allow notifications, long-press home screen → Widgets → Stak live (2x2). Start a build → ongoing progress notification + widget update live.
5. API: `curl https://stak-ai.pplx.app/port/5000/api/health`; server tests: `npm test`.
