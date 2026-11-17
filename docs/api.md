# API

All endpoints are JSON and use `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/guest · signup · login · logout`, `GET /api/auth/me`, `PATCH /api/me` |
| Intent | `POST /api/intent {prompt}` → `{kind, confidence, signals, label}` |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id` (GET → `{project, messages, versions, activeJob}`) |
| Flow | `POST /api/projects/:id/answers {answers, secrets, notes, skip}` → `{jobId}`; `POST /:id/messages {text, selection}` → `{jobId}`; `POST /:id/retry`; `POST /:id/stop`; `POST /:id/restore {version}` |
| Jobs | `GET /api/jobs/:id?from=N` → status, steps, streamed `delta`, report |
| Files | `POST /:id/uploads {name, data}`, `GET/DELETE /:id/assets`, `GET /:id/versions/:n` |
| Cloud | `GET /:id/cloud`, `GET /:id/cloud/:table`, `PUT /:id/rules`, `PATCH /:id/cloud/users/:uid`, `GET/PUT/DELETE /:id/secrets` |
| Preview | `POST /:id/preview-token`, `/api/site/:id/*`, `/api/rt/:id/*` (Stak Cloud SDK) |
| Export | `/api/dl/:id/site.zip`, `/api/dl/:id/file/:name` |
| Models | `GET/POST /api/models`, `POST /api/models/discover`, `POST /api/models/:id/test`, `PUT /api/models/selected` |
| Ops | `GET /api/health`, `GET /api/status` |
