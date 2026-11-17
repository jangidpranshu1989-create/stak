// Unit tests for Stak's deterministic engine pieces (no network, no LLM).
const os = require("os"), path = require("path"), fs = require("fs");
process.env.STAK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "stak-test-"));
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../server/intent");
const S = require("../server/site");
const SEC = require("../server/security");
const J = require("../server/jobs");

test("intent: chatbot is an app, not a website", () => {
  assert.equal(I.classify("ek AI chatbot bana jo coding doubts solve kare").kind, "app");
  assert.equal(I.classify("Kota ke restaurant ki website - menu, timing").kind, "site");
  assert.equal(I.classify("QR code generator tool").kind, "tool");
  assert.equal(I.classify("snake game for kids").kind, "game");
});

test("intentIssues: flags a landing page for an app", () => {
  const files = { "index.html": '<html><body><section class="hero"><h1>Meet ChatPro</h1><a class="btn">Get started</a></section><section id="pricing">Pricing</section><section>Testimonials</section></body></html>', "app.js": "" };
  const issues = S.intentIssues(files, "app", "chatbot");
  assert.ok(issues.some((i) => i.kind === "intent"), JSON.stringify(issues));
});

test("intentIssues: chatbot that never calls stak.ai is flagged", () => {
  const files = { "index.html": "<html><body><textarea></textarea></body></html>", "app.js": "console.log(1)" };
  assert.ok(S.intentIssues(files, "app", "ek chatbot bana").some((i) => /stak\.ai/.test(i.problem)));
});

test("intentIssues: client-side seeding is flagged", () => {
  const files = { "index.html": "<html><body></body></html>", "app.js": "const items = await stak.db.list('menu'); if (!items.length) { for (const d of DEFAULT) await stak.db.add('menu', d); }" };
  const issues = S.intentIssues(files, "site", "restaurant website");
  assert.ok(issues.some((i) => i.kind === "data"), JSON.stringify(issues));
});

test("readSeed parses stak.seed.json and ignores junk", () => {
  const seed = S.readSeed({ "stak.seed.json": JSON.stringify({ menu: [{ id: "x", owner: "u", name: "Dosa", price: 120 }], bad: "x" }) });
  assert.equal(seed.menu.length, 1);
  assert.equal(seed.menu[0].owner, undefined, "owner must be stripped");
  assert.equal(seed.bad, undefined);
  assert.equal(S.readSeed({}), null);
  assert.equal(S.readSeed({ "stak.seed.json": "{nope" }), null);
});

test("readRules returns rules and issues", () => {
  const r = S.readRules({ "stak.rules.json": JSON.stringify({ collections: { notes: { read: "owner", write: "owner" } } }) });
  assert.ok(r.rules && Array.isArray(r.issues));
});

test("applyBlock replaces exact and whitespace-tolerant matches", () => {
  const src = "a\n  const x = 1;\nb";
  const out = S.applyBlock(src, { search: "const x = 1;", replace: "const x = 2;" });
  assert.ok(out.ok);
  assert.match(out.src, /const x = 2;/);
  assert.equal(S.applyBlock(src, { search: "nothing like this", replace: "z" }).ok, false);
});

test("verify fixes CommonJS CDN builds (require is not defined)", () => {
  const r = S.verify({ "index.html": '<html><head></head><body><script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script></body></html>' }, "x");
  assert.match(r.files["index.html"], /@highlightjs\/cdn-assets@11\.9\.0\/highlight\.min\.js/);
});

test("domRefIssues: missing element ids are reported, template ids are not", () => {
  const bad = S.domRefIssues({ "index.html": '<button id="go"></button>', "app.js": "document.getElementById('calc-btn').addEventListener('click',()=>{})" });
  assert.equal(bad.length, 1);
  assert.match(bad[0].problem, /#calc-btn/);
  const ok = S.domRefIssues({ "index.html": '<div id="a"></div>', "app.js": "document.getElementById('a'); el.innerHTML = `<p id=\"b\"></p>`; document.querySelector('#b')" });
  assert.equal(ok.length, 0);
});

test("security scan catches leaked keys", () => {
  const issues = SEC.scan({ "app.js": "const k = 'gsk_" + "a".repeat(30) + "';" });
  assert.ok(issues.some((i) => /Groq/.test(i.problem)), JSON.stringify(issues));
  assert.equal(SEC.scan({ "app.js": "console.log('hi')" }).filter((i) => i.severity === "high").length, 0);
});

test("normalizeQuestions keeps valid questions and drops junk", () => {
  const q = J.normalizeQuestions([{ id: "a", question: "Who uses it?", type: "single", options: ["Me", "Team"] }, null, { foo: 1 }]);
  assert.ok(Array.isArray(q) && q.length >= 1);
  assert.ok(q.every((x) => x.question || x.q || x.text));
});
