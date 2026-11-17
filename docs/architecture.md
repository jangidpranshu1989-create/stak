# Architecture

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
