# client/ — Stak frontend

**Please read this first.** The original React source (`src/`), `package.json`, `vite.config.*` and `tailwind.config.*` for this frontend were **never provided**. Only the compiled Vite build came in `stak-frontend.txt`, packed as 6 files. A minified bundle can't be turned back into the original source, so this folder contains:

| Path | What it is |
|---|---|
| `dist/` | The production build that is actually served. It is identical to `../public/`. The UI is unchanged from the original build, except for the small patches listed in `PATCHES.md`. |
| `dist/assets/index-dfQllqH2.js` | Patched app bundle. The filename was kept the same so `index.html` keeps working. |
| `dist/assets/index-DAoFErLZ.css` | Original Tailwind CSS output (unchanged, already purged). |
| `patches/StakImgQ.js` | Readable source of the new photo-question component that was inserted into the bundle. |
| `PATCHES.md` | Every change made to the bundle, each with a search anchor so you can find and re-apply it. |

No `vite.config`, `tailwind.config` or `package.json` is included on purpose. Writing fake ones would not rebuild this exact UI.

## What the bundle uses

These are detected from the minified code and are only hints, in case you rebuild the client:

- React 18 + react-dom
- @tanstack/react-query
- wouter (routing)
- Radix UI primitives
- lucide-react icons
- framer-motion
- Tailwind CSS 3 (shadcn-style tokens such as `bg-primary`, `text-muted-foreground`)
- fonts: Geist, Geist Mono, Instrument Serif, Noto Sans (Devanagari/Bengali/Tamil/Telugu/Gujarati)

## Serving

The server serves `../public/` statically (`express.static`) and falls back to `index.html`. To deploy a changed frontend, replace the files in `public/` (and copy them here as well).

The API contract the client expects is in `../shared/types.ts`:

- Every request sends `Authorization: Bearer <stak_token>` and `X-Stak-Model`.
- Jobs are polled every 700 ms.

## If you get the original source back

1. Put it in `client/` (`src/`, `package.json`, `vite.config.ts`, `tailwind.config.ts`).
2. Re-apply the changes in `PATCHES.md` as normal React code. `patches/StakImgQ.js` becomes `src/components/ImagesQuestion.tsx`.
3. Run `npm run build` with `base: "./"`, then copy `dist/*` to `../public/`.
