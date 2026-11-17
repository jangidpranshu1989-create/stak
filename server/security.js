// Per-build security scan. Every AI builder has shipped apps with exposed admin panels and leaked keys;
// Stak checks generated code before it goes live and reports (and auto-repairs) what it finds.
const SEVERITY = { high: 3, medium: 2, low: 1 };

const KEY_PATTERNS = [
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, "OpenAI-style secret key"],
  [/\bgsk_[A-Za-z0-9]{20,}/, "Groq API key"],
  [/\bnvapi-[A-Za-z0-9_-]{20,}/, "NVIDIA API key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, "private key"],
  [/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i, "hard-coded credential"],
];

function scan(files, { rules } = {}) {
  const issues = [];
  const add = (file, severity, problem, fix) => issues.push({ file, severity, problem, fix, kind: "security" });
  for (const [p, c] of Object.entries(files)) {
    if (!/\.(html?|js|json|css)$/.test(p) || p === "stak-ui.js" || p === "stak.js") continue;
    const s = String(c);
    for (const [re, label] of KEY_PATTERNS) if (re.test(s)) add(p, "high", `Contains a ${label} in client code — anyone can read it`, "Remove it and use stak.fetch with a {{SECRET_NAME}} placeholder (saved in Secrets)");
    if (/\beval\s*\(|new Function\s*\(/.test(s) && /\.js$|\.html?$/.test(p)) add(p, "medium", "Uses eval()/new Function — code-injection risk", "Replace with explicit logic or JSON.parse");
    if (/\.js$|\.html?$/.test(p)) {
      // innerHTML built from obviously untrusted sources (user input, API/db data) without escaping
      const risky = [...s.matchAll(/\.innerHTML\s*[+]?=\s*([^;\n]{0,220})/g)].filter((m) => /\$\{[^}]*(\.value|input|text|content|message|msg|name|title|query|q|item\.|doc\.|data\.|reply|answer)[^}]*\}/i.test(m[1]) && !/esc(ape)?(Html)?\s*\(|sanitize|DOMPurify|textContent/i.test(m[1]));
      if (risky.length) add(p, "medium", `innerHTML with unescaped dynamic data (${risky.length}×) — XSS risk`, "Wrap values in an esc() helper or use textContent");
      if (/document\.write\s*\(/.test(s)) add(p, "low", "Uses document.write", "Build DOM with createElement/textContent");
    }
  }
  // admin pages must check the server-side role
  for (const p of Object.keys(files).filter((x) => /admin|dashboard-admin|owner/i.test(x) && /\.html?$/.test(x))) {
    const page = files[p] + "\n" + Object.entries(files).filter(([q]) => q.endsWith(".js")).map(([, c]) => c).join("\n");
    if (!/stak\.auth\.(isAdmin|user\??\.role)/.test(page)) add(p, "high", "Admin page has no admin check — anyone who opens it can manage data", "Gate it with `if (!stak.auth.isAdmin) showSignIn()` (role is verified on the server)");
  }
  // data rules: personal data must not be world-readable
  const PRIVATE = /order|booking|appointment|reservation|lead|contact|enquir|inquir|message|submission|application|payment|customer|patient|note|expense|journal|diary|chat/i;
  const cols = new Set();
  for (const c of Object.values(files)) for (const m of String(c).matchAll(/collection\(\s*["'`]([\w-]{1,40})["'`]/g)) cols.add(m[1]);
  for (const name of cols) {
    const r = rules?.collections?.[name];
    if (PRIVATE.test(name) && r && r.read === "public") add("stak.rules.json", "high", `Collection "${name}" holds personal data but is publicly readable`, `Set "read": "owner" or "admin" for ${name}`);
  }
  issues.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  return issues;
}

function grade(issues) {
  const pts = issues.reduce((n, i) => n + (i.severity === "high" ? 30 : i.severity === "medium" ? 12 : 4), 0);
  const score = Math.max(0, 100 - pts);
  return { score, label: score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : "D" };
}

module.exports = { scan, grade, KEY_PATTERNS };
