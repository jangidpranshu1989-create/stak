# Stak v3 — intent-aware AI app builder

Describe what you want in English or Hinglish. Stak works out **what kind of thing** you meant (app, tool, game or website), asks a few short questions, then builds it, tests it, repairs it and publishes it with a real backend: database, sign-in, AI and server-side API keys.

> "ek AI chatbot bana" opens a working chat screen, not a marketing page about a chatbot.

## What makes it different

| | What Stak does |
|---|---|
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
- One server instance only. Horizontal scaling needs Postgres and a shared queue.

See `docs/` for the architecture, security model and API reference.
