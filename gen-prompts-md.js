// Regenerates prompts.md from the live prompt sources (server/prompts.js + server/probe.js).
// Usage: node scripts/gen-prompts-md.js
const fs = require("fs"), path = require("path");
const P = require("../server/prompts");
const probe = fs.readFileSync(path.join(__dirname, "../server/probe.js"), "utf8");
const grab = (name) => { const m = probe.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;\\n")); return m ? m[1] : ""; };
const block = (s) => "```text\n" + s.trim() + "\n```\n";
const LANG = "en";
let md = `# Stak — AI system prompts & formats

Generated from \`server/prompts.js\` and \`server/probe.js\` by \`node scripts/gen-prompts-md.js\`.
Shown with \`lang = "${LANG}"\`; at runtime \`\${langName(lang)}\` is replaced by the user's language (English, Hindi, Hinglish, …).

| Step | System prompt | Model role | Output format |
|---|---|---|---|
| Clarifying questions | QUESTIONS_SYSTEM | fast | Questions JSON |
| Plan (Stak Think only) | PLAN_SYSTEM | plan | plain text plan (≤250 words) |
| Build | BUILD_SYSTEM | build | \`<stak-file>\` blocks + \`<stak-image>\` + \`<stak-summary>\` |
| Edit | EDIT_SYSTEM | build | \`<stak-patch>\` / \`<stak-file>\` + \`<stak-image>\` + \`<stak-summary>\` |
| QA repair | REPAIR_SYSTEM | build | one \`<stak-file>\` |
| Model test | probe prompts (below) | user model | \`<stak-file>\`, Questions JSON |

---

## 1. QUESTIONS_SYSTEM
${block(P.QUESTIONS_SYSTEM(LANG))}
### Questions JSON format
\`\`\`json
{
  "title": "Aarav Photography",
  "reply": "Short warm reply in the user's language",
  "questions": [
    { "id": "q1", "type": "single", "question": "What style?", "options": ["Minimal", "Bold", "Luxury"] },
    { "id": "q2", "type": "multi",  "question": "Which pages?", "options": ["Home", "Gallery", "Pricing", "Contact"] },
    { "id": "q3", "type": "text",   "question": "Business name?", "placeholder": "e.g. Aarav Studio" },
    { "id": "q4", "type": "images", "slot": "portfolio", "max": 12,
      "question": "Do you want to add your own photos for the Works section?",
      "options": ["Yes — I'll upload my photos", "No — pick the best images for me"],
      "aiNote": "Stak will create original, on-brand photos (no random stock)." },
    { "id": "q5", "type": "secret", "question": "OpenWeather key (optional)", "secretName": "OPENWEATHER_KEY", "helpUrl": "https://openweathermap.org/api" }
  ]
}
\`\`\`
Server rules (\`normalizeQuestions\` + \`ensureImagesQuestion\` in \`server/jobs.js\`): ids renumbered q1..qN; aliases \`choice/radio→single\`, \`checkbox→multi\`, \`image/upload/photos→images\`; max one \`secret\` question; for photo-heavy ideas (portfolio, photographer, restaurant, salon, hotel, real-estate, wedding…) an \`images\` question is inserted at position 4 if the model forgot it.

Answer format sent back by the client (\`POST /api/projects/:id/answers\`):
\`\`\`json
{ "answers": { "q1": ["Minimal"], "q4": ["Yes — I'll upload my photos", "upload:assets/uploads/wed-1-ab12c.jpg", "upload:assets/uploads/wed-2-x9k2p.jpg"] },
  "notes": "", "skip": false, "secrets": {}, "lang": "en" }
\`\`\`
\`["No — pick the best images for me", "upload:ai"]\` means: generate AI photos for that slot.

---

## 2. BUILD_SYSTEM
${block(P.BUILD_SYSTEM(LANG))}
---

## 3. PLAN_SYSTEM (Stak Think)
${block(P.PLAN_SYSTEM(LANG))}
The plan text is appended to the build request as \`BUILD PLAN:\` and the build then runs with BUILD_SYSTEM.

---

## 4. EDIT_SYSTEM
${block(P.EDIT_SYSTEM(LANG))}
---

## 5. REPAIR_SYSTEM (automatic QA)
${block(P.REPAIR_SYSTEM)}
---

## 6. Shared docs embedded in the prompts
### SDK_DOC (Stak Cloud SDK — window.stak)
${block(P.SDK_DOC)}
### FULLSTACK_DOC
${block(P.FULLSTACK_DOC)}
### IMAGES_DOC
${block(P.IMAGES_DOC)}
### MOTION_DOC
${block(P.MOTION_DOC)}
### FORMAT_DOC
${block(P.FORMAT_DOC)}
---

## 7. Output tag formats (parsed by server/site.js and server/images.js)
\`\`\`html
<stak-file path="index.html">
...complete file...
</stak-file>

<stak-patch path="styles.css">
<<<<<<< SEARCH
.hero { padding: 40px; }
=======
.hero { padding: 72px 24px; }
>>>>>>> REPLACE
</stak-patch>

<stak-image path="assets/img/hero.jpg" aspect="16:9">Golden-hour portrait of an Indian bride on a palace terrace, Jaipur, soft film look</stak-image>

<stak-summary>One or two sentences describing what was built/changed.</stak-summary>
\`\`\`
- \`path\` must be a relative safe path (no \`..\`, max 40 files, text files only).
- \`<stak-image>\` attributes can be in any order; \`aspect\` ∈ 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (default 4:3). Max 8 AI images per build/edit; 4 generated in parallel.
- Any \`assets/img/*.jpg\` referenced in HTML/CSS without a declaration gets an inferred prompt from its alt text + project context.
- User uploads live at \`assets/uploads/*\` and must be used at exactly those paths.

### Job stream (\`GET /api/jobs/:id?from=N\`, polled every 700 ms)
\`\`\`json
{ "status": "running", "phase": "writing:index.html", "delta": "<stak-file path=\\"index.html\\">…", "doneFiles": ["styles.css"],
  "elapsed": 41.2, "error": null, "type": "build", "model": "Stak Pro", "notes": [] }
\`\`\`
phase: \`thinking → planning (Think) → writing:<file> → verifying → repairing → images:d/t → finishing → done\`.

---

## 8. Model test prompts (server/probe.js)
Run when a user adds an NVIDIA / Groq / custom OpenAI-compatible model.

**Step 1 — connect** (system: empty, max 400 tokens, temperature 0):
\`\`\`text
Reply with exactly: OK
\`\`\`
**Step 2 — small app** (system: \`You are an expert front-end engineer. Follow the output format exactly.\`):
${block(grab("SMALL_APP"))}
Checks: \`formatOk\` = index.html parsed and has \`<html>\`; \`functional\` = has button/input + event handlers + all scripts compile (\`vm.Script\`) + closing \`</html>\`.

**Step 3 — questions JSON**: system = QUESTIONS_SYSTEM("en"), user = \`The user's idea: """A website for my home bakery in Jaipur"""\`. \`jsonOk\` = valid JSON, title present, ≥4 normalized questions.

**Step 4 — full-stack guestbook** (system: \`You are an expert full-stack engineer. Follow the output format exactly.\` + short SDK summary):
${block(grab("GUESTBOOK").replace('${P.BUILD_SYSTEM ? "" : ""}', "").replace(/\$\{"([\s\S]*?)"\}/, (_, s) => s.replace(/\\"/g, '"')))}
\`fullstack\` = index.html loads stak.js, code uses \`stak.db.collection(\`, \`.add(\`, \`.list(\`, scripts compile.

### Score (0–100)
\`\`\`text
score = formatOk 25 + functional 20 + jsonOk 20 + fullstack 15 + speed (min(20, round(tokensPerSec / 6)))
categories: fast if tps ≥ 120 · thinking if model emitted reasoning/<think> · deep if score ≥ 75 and functional
            (none matched → fast if tps ≥ 60 else deep)
status:     ready  = formatOk && jsonOk   (usable for builds)
            chat   = otherwise            (questions/chat only; builds use Stak Pro)
            failed = connect or build request errored
\`\`\`
Fallback at runtime: if a user model errors during questions/build/edit, the job automatically retries with **Stak Pro** and adds a note ("<model> failed — used Stak Pro").
`;
fs.writeFileSync(path.join(__dirname, "../prompts.md"), md);
console.log("prompts.md", md.length, "chars");
