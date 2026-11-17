# Architecture

## Template-first generation (`server/templates/`)

Free models writing an entire app in one shot produce mediocre UI with broken parts, and Groq's free 8k tokens/minute cannot fit repair prompts that contain full files. Lovable and v0 avoid this by starting every build from a curated design system and starter code. Stak does the same:

1. `pick(prompt, kind)` routes chatbots → `chat`, trackers/dashboards → `tracker`, and every website → `site`. Everything else (tools, games, unusual apps) falls through to free generation. Set `STAK_TEMPLATES=0` to disable this.
2. A single plan-role call writes a JSON config (about 1k tokens) against a strict schema in `PROMPTS`.
3. `normChat` / `normTracker` / `normSite` validate everything: hex colours, contrast-safe accent text, a whitelist of icons, field types and safe defaults. `enforceFacts` replaces any city the model copied from web research with the city the user actually named.
4. `render()` emits plain files: `index.html`, `styles.css` (shared tokens in `shared/base.css` plus template CSS), `config.js` (`window.APP`), `icons.js` (inline Lucide), `kit.js` (store, toast with undo, confirm, theme, money/date formatting, CSV download) and `app.js`.
5. Later edits are steered to `config.js` first. Large template files are left out of the edit prompt.

| Template | What you get |
|---|---|
| chat | ChatGPT-style layout with grouped history, search, rename/delete with undo, a streaming `stak.ai.chat` answer with stop, a safe markdown renderer (nested lists, tables, code with copy), regenerate, a dark mode and a mobile drawer. Replies match the user's script (Roman Hinglish stays Roman). |
| tracker | Any record type (expenses, habits, stock, leads). Stat cards, a 6-month bar chart, a category donut, a records list grouped by day with search/filter/sort, a validated add/edit sheet, a budget, CSV export/import and sample data that is always dated relative to today. |
| site | Static, SEO-friendly page with JSON-LD and four font personalities. Sections: hero, features, a tabbed menu, pricing, gallery, about, testimonials, team, FAQ, CTA, plus contact with a map and a lead form that saves to `stak.db`, and a WhatsApp button. |

Runtime AI inside generated apps uses its own `appchat` chain (GPT-OSS 120B first), so a chatbot you build answers with the strongest fast model, not the draft model.

## Build pipeline (`server/jobs.js`)

1. **Intent**: `intent.classify(prompt)` returns `{kind, confidence, signals}`. The user can override the kind on the home screen.
2. **Questions**: the fast model returns 3–7 questions as JSON. `normalizeQuestions` cleans them, and an images question is added for photo-heavy ideas.
3. **Blueprint**: the plan model writes the name, features, data model and acceptance checks.
4. **Research** (optional): for live facts it runs web search and injects sources.
5. **Build**: the build model streams `<stak-file>` blocks. `llm.js` validates the output (index.html must parse). Invalid output falls through to the next model.
6. **Verify and auto-fix** (`site.verifyFull`) covers:
   - viewport, stylesheet and script wiring;
   - favicon;
   - broken internal links;
   - CommonJS CDN builds;
   - syntax and runtime ReferenceErrors (in a vm sandbox with DOM stubs);
   - missing DOM ids;
   - intent mismatches (landing page for an app, no AI call, no input handlers, sign-in wall, client-side seeding);
   - rules validation.
7. **Photos**: Wikimedia search in parallel, with credits.
8. **Security scan**: leaked keys, `innerHTML` with user data, admin pages without role checks, open write rules.
9. **AI acceptance review**: it checks each blueprint item against the code.
10. **Repair**: at most `STAK_REPAIR_ROUNDS` rounds of patches. A **re-check** then re-reviews only the items that failed, and the report shows the real result.
11. **Publish**: the files are saved as a new version, and `stak.seed.json` documents are inserted once into empty collections.

Edits use the same verify, repair and review loop, with SEARCH/REPLACE patches and a regression guard.

## Model routing (`server/llm.js`)

- Presets: Pro, Think and Fast. Each maps to a chain of models.
- Health checks run at boot. A failing model is cooled down (429 → retry-after; 5xx → exponential backoff).
- When the last option is rate-limited, the call waits once (≤30 s) and retries.
- When the stream stops at the token limit, it continues automatically.
