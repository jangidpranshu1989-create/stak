const test = require("node:test");
const assert = require("node:assert");
const S = require("../server/site");
const TW = require("../server/tw");

test("parseFiles survives missing </stak-file> tags", () => {
  const t = `<stak-summary>x</stak-summary>\n<stak-file path="index.html">\n<html></html>\n<stak-file path="styles.css">\nbody{}\n</stak-file>\n<stak-file path='app.js'>\nrun()\n<stak-file path="stak.rules.json">\n{}`;
  const f = S.parseFiles(t);
  assert.deepStrictEqual(Object.keys(f), ["index.html", "styles.css", "app.js", "stak.rules.json"]);
  assert.strictEqual(f["index.html"].trim(), "<html></html>");
  assert.strictEqual(f["app.js"].trim(), "run()");
});

test("Tailwind classes compile into stak-tw.css and get linked", async () => {
  const files = { "index.html": '<html><head><link rel="stylesheet" href="stak-ui.css"><link rel="stylesheet" href="styles.css"></head><body class="flex items-center gap-2 bg-primary/10 lg:grid-cols-[1fr_320px]"></body></html>' };
  const out = await TW.apply(S.withKit(files), { force: true });
  assert.ok(out["stak-tw.css"].includes(".items-center"));
  assert.ok(out["stak-tw.css"].includes("hsl(var(--primary)"));
  assert.ok(/stak-ui\.css">\s*<link rel="stylesheet" href="stak-tw\.css">/.test(out["index.html"]));
  assert.deepStrictEqual(TW.undefinedClasses(out), []);
});

test("design lint flags invented classes", async () => {
  const out = await TW.apply(S.withKit({ "index.html": '<html><head><link rel="stylesheet" href="stak-ui.css"></head><body><div class="flex fancy-box glow-card super-btn"></div></body></html>' }));
  assert.deepStrictEqual(TW.undefinedClasses(out).sort(), ["fancy-box", "glow-card", "super-btn"]);
});

test("icons: helper bundled, on-demand Lucide icons, unknown names snapped", () => {
  const out = S.withKit({ "index.html": '<script src="stak-ui.js"></script><i data-icon="swap"></i><i data-icon="rocket"></i>', "app.js": 'Icon("weight")' });
  assert.ok(out["stak-ui.js"].includes("data-icon"));
  assert.ok(out["stak-ui.js"].includes('"timer"'));
  assert.ok(out["stak-ui.js"].includes('"weight"'));
  assert.ok(out["index.html"].includes('data-icon="arrow-left-right"'));
  assert.strictEqual(S.nearestIcon("temperature-high"), "thermometer");
});

test("startup check flags apps that never render on load", () => {
  const dead = { "app.js": "function load(){}\nfunction render(){ document.body.innerHTML='x' }\nfunction add(){ render() }\ndocument.getElementById('a').addEventListener('click', add);" };
  assert.strictEqual(S.startupIssues(dead).length, 1);
  const ok = { "app.js": dead["app.js"] + "\nload();\nrender();" };
  assert.strictEqual(S.startupIssues(ok).length, 0);
  const dom = { "app.js": "function a(){}\nfunction b(){}\nfunction c(){}\ndocument.addEventListener('DOMContentLoaded', () => { a(); });" };
  assert.strictEqual(S.startupIssues(dom).length, 0);
});

test("apostrophe inside a single-quoted string is auto-repaired", () => {
  const bad = "const a = 1;\nconst msg = '<p>Couldn't load</p>' + a;\n";
  const fixed = S.fixApostrophes(bad);
  assert.ok(fixed);
  new (require("vm").Script)(fixed);
});
