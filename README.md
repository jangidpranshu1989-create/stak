# Stak v2 — AI website & app builder

Stak takes an idea, asks a few smart questions, researches the web in real time when needed, and builds a complete full-stack site:
pages, admin panel, database, login, live public APIs, realtime updates, original AI photos (or your own uploads), and a shadcn-style UI kit.
Edit by chat, preview live, download as zip, share — and follow builds from the Android app with notifications and home-screen widgets.

## What's new in v2

- **Groq + NVIDIA NIM + any OpenAI-compatible key** (Anthropic removed). 12 built-in models + 3 presets (Stak Pro / Think / Fast) with health-checked fallback chains, TPM-aware routing and automatic stream continuation.
- **Real-time web search** for builds, edits and generated apps (`stak.web.search / answer`): Groq browser_search → Tavily → Brave → Serper → keyless DuckDuckGo + Wikipedia.
- **Image fix:** "Do you want to use your own photos?" question with tick-style upload; otherwise Stak generates relevant real-photo images (never random stock / unknown placeholders, never UI screenshots).
- **World-class design system:** `stak-ui.css` / `stak-ui.js` (tokens, buttons, cards, dialog, tabs, dropdown, toast, form validation, dark mode) + a design checklist in every prompt.
- **Mobile API** (`/api/mobile/*`) + **native Android app** (`stak-android/`): background builds, follow-up-question notifications, 3 real-time 2×2 widgets.
- Health/status endpoints, security headers, `__Host-` cookies on HTTPS, Docker / docker-compose / render.yaml.

```
stak/
├── server/
│   ├── index.js      routes: auth, projects, uploads, jobs, models, push, search, mobile, site/dl/rt, rate limits
│   ├── config.js     every env var → providers / images / search config
│   ├── llm.js        OpenAI-compatible LLM proxy: catalog, presets, fallback chains, health, continuation
│   ├── search.js     real-time web search + page reader + research summariser
│   ├── jobs.js       questions → research → (plan) → build → QA/repair ∥ images → save; edits; events
│   ├── images.js     image specs, stock-URL replacement, NVIDIA FLUX / OpenAI / Pexels / Unsplash
│   ├── prompts.js    all system prompts (see prompts.md)
│   ├── site.js       file/patch parsing, QA, preview, zip, UI-kit injection
│   ├── probe.js      user-model test + scoring
│   ├── db.js         SQLite + migrations + AES-256-GCM
│   └── runtime/      stak.js (Stak Cloud SDK), stak-motion.js, stak-ui.css, stak-ui.js
├── shared/           types.ts, schema.sql, migrations/001-003
├── client/           prebuilt Vite + React frontend (patched bundle) — see client/README.md
├── public/           static files served by Express (= client/dist)
├── stak-android/     native Android app (Kotlin, widgets, notifications) — see stak-android/README.md
├── docs/models.md    providers, model catalog, chains, continuation, TPM
├── prompts.md        every system prompt + formats
├── Dockerfile · docker-compose.yml · render.yaml · .env.example
└── scripts/          gen-prompts-md.js, pack.py
```

## Run locally

```bash
npm ci
cp .env.example .env      # set STAK_SECRET + GROQ_API_KEY and/or NVIDIA_API_KEY
npm run start:env         # http://localhost:5000
```

Minimum: one of `GROQ_API_KEY`, `NVIDIA_API_KEY`, or `OPENAI_COMPAT_BASE_URL`+`OPENAI_COMPAT_API_KEY`. `NVIDIA_API_KEY` also enables FLUX photos.
Without any image key Stak falls back to Pexels/Unsplash (if keys set), otherwise clean gradient placeholders — never random images.
Users can also add their own OpenAI-compatible models in the UI (Settings → Models), encrypted per user.

### Free Groq keys

Free Groq keys allow ~8000 tokens/minute per model, smaller than one full build prompt. Stak detects this (`GROQ_TPM`, default 8000) and lets NVIDIA lead full builds, while Groq still handles questions, research and quick edits. With a paid/Dev key set `GROQ_TPM=250000` and GPT-OSS 120B becomes the first builder (much faster).

## Deploy

**Docker:** `docker compose up -d --build` (data in the `stak-data` volume).
**Render:** push the repo, "New → Blueprint", it reads `render.yaml` (1 GB disk at `/data`); then set the API keys.
**Any VPS / Railway / Fly:** `npm ci --omit=dev && node server/index.js`, set `STAK_DATA_DIR` to a persistent disk, put HTTPS in front (cookies become `__Host-stak_token`).
Run a **single instance** (SQLite + in-memory job queue). Health check: `GET /api/health`.

## How a build works

1. `POST /api/projects {prompt, lang}` starts a **questions** job. The fast model returns Questions JSON with 4–7 questions.
   - For photo-heavy ideas there is always an `images` question: "upload your own photos?" or "let Stak create the best photos".
2. The user answers, and may upload photos (`POST /api/projects/:id/uploads`, stored in the `assets` table). This happens in `POST /:id/answers`, which starts a **build** job:
   - Research: if the idea needs live facts (news, sports, prices, "latest", a real business…), Stak runs real-time web search first and injects a LIVE WEB RESEARCH block + sources.
   - Stak Think only: `PLAN_SYSTEM` writes a plan.
   - `BUILD_SYSTEM` streams `<stak-file>` blocks. The frontend polls `GET /api/jobs/:id?from=N` every 700 ms.
   - QA: the HTML/JS/CSS checks run. Up to 3 broken files are repaired (4-min deadline).
   - Images: `<stak-image>` declarations, plus any referenced `assets/img/*` that is missing, are generated by NVIDIA FLUX (in parallel with QA). Any stock/placeholder URL the model wrote (unsplash, picsum, pravatar…) is replaced with a real generated local photo. Uploaded photos are always used first.
   - The result is saved as a new version.
3. Chat edits (`POST /:id/messages`) use `EDIT_SYSTEM` with `<stak-patch>` SEARCH/REPLACE blocks or full files. New images are generated the same way.
4. Preview and share:
   - `GET /api/site/:id/` serves the latest version, with `stak.js` injected.
   - `/api/rt/:id/*` is Stak Cloud: per-project auth, a document DB with `subscribe()` realtime, file uploads, AI chat, and a secret-backed `fetch` proxy.
   - `/api/dl/:id/site.zip` downloads everything, assets included.

What every generated site can do (FULLSTACK_DOC in `prompts.md`):

- forms save to `stak.db`;
- owner-managed content (gallery, menu, products…) lives in collections;
- an `admin.html` where the first account becomes the owner;
- live public APIs (Open-Meteo, CoinGecko, Frankfurter…) that auto-refresh;
- key-based APIs through `stak.fetch` with `{{SECRET}}`.

## API summary

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/guest · signup · login · logout`, `GET /api/auth/me`, `PATCH /api/me` |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST /:id/answers · messages · retry · restore`, `GET /:id/versions/:n` |
| Photos | `POST /api/projects/:id/uploads {name, data:dataURL}` → `{path,url}`, `GET /:id/assets`, `DELETE /:id/assets?path=` |
| Secrets & Cloud | `GET/PUT /:id/secrets`, `DELETE /:id/secrets/:name`, `GET /:id/cloud`, `GET /:id/cloud/:table` |
| Jobs | `GET /api/jobs/:id?from=N` |
| Models | `GET/POST /api/models`, `POST /api/models/discover`, `DELETE /api/models/:id`, `POST /api/models/:id/test`, `PUT /api/models/selected` |
| Push | `GET /api/push/key`, `POST /api/push/subscribe` |
| Search | `POST /api/search {q}` → `{results}` (generated apps: `/api/rt/:id/web/search` · `web/answer`) |
| Mobile | `GET /api/mobile/summary` (projects, running jobs, pending questions, usage), `GET /api/mobile/events?after=ID` (questions_ready, build_done, edit_done, job_failed) |
| Health | `GET /api/health`, `GET /api/status` (providers, model health, search & image providers) |
| Sites | `/api/site/:id/*`, `/api/rt/:id/*` (Stak Cloud), `/api/dl/:id/site.zip`, `/api/dl/:id/file/:name`, `/api/thumb/:id/:v` |

Full request and response types are in `shared/types.ts`.

## Rate limits & daily caps

| | AI actions / min | AI actions / day | new projects / day | model tests / day |
|---|---|---|---|---|
| Guest | 4 (and 8 per IP) | 20 | 5 | 6 |
| Account | 10 | 150 | 60 | 30 |

Other limits:

- **Guest sessions:** at most 5 per minute and 8 per day per visitor or IP.
- **Uploads:** at most 6 MB each and 60 per project, images only.
- **Stak Cloud runtime:** has its own per-IP limits.
- **Storage:** counters live in the `usage` table, keyed by day.

## Security notes

- Passwords are hashed with scrypt. Sessions are random bearer tokens (cookie `stak_token`, or `__Host-stak_token` on HTTPS).
- User API keys and project secrets are encrypted with AES-256-GCM and never returned in full.
- `stak.fetch` swaps in `{{SECRET}}` values on the server side, so keys never reach the browser. It blocks private and loopback addresses.
- **No real keys are included in this repo.** Keep `.env` out of git; `.gitignore` already covers it.

## Limitations

- Jobs run in memory. If the server restarts mid-build, that job is lost. Retry it from the UI.
- AI photos take 3–15 s each (FLUX, in parallel), at most `STAK_IMAGES_PER_BUILD` per build.
- NVIDIA free endpoints can be slow or temporarily down; Stak health-checks, falls back and continues cut streams, but a full build can still take 5–12 min on free keys.
- The React source of the client was not available; v2 UI changes are small patches to the built bundle (see client/PATCHES.md).
- Chat messages can't attach images yet. Photos are added through the question step, or later through the generated site's admin page.
- Single process only, because of SQLite and in-memory jobs. Don't run multiple replicas.

## Android app

`stak-android/` is a native Kotlin app (WebView shell tuned for phones + native layer):
- edge-to-edge, pixel-fit mobile layout, pull-to-refresh, file/photo picker for uploads, downloads, deep links `stak://app/<projectId>`;
- background sync (WorkManager + foreground service while a build runs) using `/api/mobile/events`;
- notifications when follow-up questions are ready, a build/edit finishes, or fails;
- 3 home-screen widgets (2×2, resizable): **Live Build** (progress), **Questions & Projects**, **Quick Build**.

Build: see `stak-android/README.md` (`./gradlew assembleRelease -Pstak.baseUrl=https://your-stak-host`).
