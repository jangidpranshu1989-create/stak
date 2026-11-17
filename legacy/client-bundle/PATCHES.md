# Patches applied to `dist/assets/index-dfQllqH2.js`

The original build was extracted from `stak-frontend.txt`. The changes below are the only ones made to it. The CSS, `index.html`, `favicon.svg`, `manifest.webmanifest` and `stak-sw.js` are byte-identical to the original.

Each anchor is a literal string you can search for in the bundle.

## 1. New component `StakImgQ` (photo question)
- **Where:** inserted right before `function iL(`, the original secret-question component that follows it.
- **Source:** `patches/StakImgQ.js`.
- **Props:** `{ q, value, onChange, projectId, onNext }`.
- **What it shows:**
  - Two option cards with a tick in a circle: "Yes, I'll upload my own photos" and "No, pick the best images for me". When the AI card is selected, it shows `q.aiNote`.
  - **Own photos:**
    - a dropzone with click, drag & drop and multi-select;
    - the client downsizes each photo to 2000 px with canvas and JPEG at 0.86 (PNG stays PNG), then uploads it to `POST /api/projects/:id/uploads`;
    - a 4-column thumbnail grid with a green tick on each photo, an X to remove, upload spinners, an `n / max` counter and an error line.
  - **Value format:**
    - own photos: `[label, "upload:assets/uploads/…", …]`
    - AI photos: `[label, "upload:ai"]`
  - Layout uses inline styles, because the purged Tailwind CSS doesn't contain new utility classes.

## 2. Question renderer branch
- **Anchor:** `T.type==="images"?l.jsx(StakImgQ,{q:T,value:p[T.id]||[],onChange:R=>v(L=>({...L,[T.id]:R})),projectId:e.projectId,onNext:()=>A(1)}):T.type==="secret"?`
- **Before:** `T.type==="secret"?…`
- **Change:** an `images` branch was added in front of it.

## 3. Question title icon
- **Anchor:** `T.type==="images"&&l.jsx("span",{className:"mt-0.5 w-6 h-6 shrink-0 rounded-lg bg-primary/15 text-primary grid place-items-center"`
- **Change:** an image icon now shows next to the title of an images question, styled like the existing key icon for secret questions.

## 4. Notes-step chips
- **Anchor:** `.filter(L=>!String(L).startsWith("upload:"))`
- **Change:** the answer summary chips no longer show raw `upload:` values. Only the label shows, for example "Yes, I'll upload my own photos".

## 5. Preview: relative asset URLs (K0 srcdoc builder)
- **Anchor:** `t?.api&&(i=i.replace(/(["'(\s,])\.?\/?(assets\/[\w\-./%]+\.(?:jpe?g|png|webp|gif|avif|svg|mp4|webm))(?=["')\s,?#])/gi,(v,g,w)=>`${g}${t.api}/${w}`))`
- **Why:** the live preview is an iframe `srcdoc`, so relative URLs like `assets/img/hero.jpg` have no base.
- **Change:** they are rewritten to `/api/rt/:id/assets/...`, which the server serves from the `assets` table.

## 6. Embedded Stak Cloud SDK literal (`qO`, used inside the preview)
- **Anchor:** `subscribe: function(cb, o){`
- **Change:** added `collection.subscribe(cb, {where, sort, limit, interval})` for realtime lists. It works by polling, pauses while the page is hidden, and returns `unsubscribe()`. This matches `server/runtime/stak.js`.

## 7. Strings
- **`stepImages`** (en): "Creating your photos"
- **`stepImages`** (hinglish): "Aapke liye photos bana raha hoon"
- **`stepImages`** (hi): "आपके लिए फ़ोटो बना रहा हूँ"
