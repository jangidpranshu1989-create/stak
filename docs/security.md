# Security model

- **Sessions**: random bearer tokens with expiry (`STAK_SESSION_DAYS`); passwords use scrypt. Guests are upgraded in place on sign-up.
- **Secrets**: AES-256-GCM using a key derived from `STAK_SECRET`. They are used only inside `stak.fetch` on the server via `{{NAME}}` placeholders and are never sent to the browser.
- **Data rules**: `stak.rules.json` sets read/write rights per collection (`public`, `signedIn`, `owner`, `admin`). The server enforces them on every `/api/rt` request.
- **Seed data**: inserted by the server from `stak.seed.json` (owner `NULL`). Generated code is told never to write starter data from the client.
- **Preview-as-admin**: the builder receives a `pv_` token scoped to one project for 2 hours. The preview iframe sends it as `X-Stak-Preview`. It is never available to public visitors.
- **Outbound fetch**: `netsafe.js` blocks private and loopback addresses (SSRF).
- **Per-build scan**: `security.js` grades each version A–F and feeds high-severity findings into repair.
- **Rate limits**: per-IP and per-user quotas for AI actions and new projects (`STAK_*_AI_*`, `STAK_*_PROJ_DAY`).
