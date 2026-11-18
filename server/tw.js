// Tailwind for generated apps, compiled on the SERVER at save time.
//
// Why: every model (free ones included) writes Tailwind fluently — it is what Lovable / v0 / Bolt generate.
// Before, Stak only had its own kit classes, so models still wrote `flex items-center gap-2 py-4` and those
// classes silently did nothing → broken, unstyled layouts on any prompt outside the hand-built templates.
// Now whatever utilities the model writes become a real static `stak-tw.css` (no CDN, works offline and in ZIPs),
// themed with the same shadcn-style tokens as stak-ui.css (bg-primary, text-muted-foreground, border-border…).
const crypto = require("crypto");
const postcss = require("postcss");
const tailwind = require("tailwindcss");

const FILE = "stak-tw.css";
const hsl = (v) => `hsl(var(--${v}) / <alpha-value>)`;
const CONFIG = (content) => ({
  content: [{ raw: content, extension: "html" }],
  darkMode: ["variant", [".dark &", "[data-theme=dark] &"]],
  theme: {
    extend: {
      colors: {
        border: hsl("border"), input: hsl("input"), ring: hsl("ring"), background: hsl("background"), foreground: hsl("foreground"),
        primary: { DEFAULT: hsl("primary"), foreground: hsl("primary-foreground") },
        secondary: { DEFAULT: hsl("secondary"), foreground: hsl("secondary-foreground") },
        destructive: { DEFAULT: hsl("destructive"), foreground: hsl("destructive-foreground") },
        muted: { DEFAULT: hsl("muted"), foreground: hsl("muted-foreground") },
        accent: { DEFAULT: hsl("accent"), foreground: hsl("accent-foreground") },
        card: { DEFAULT: hsl("card"), foreground: hsl("card-foreground") },
        popover: { DEFAULT: hsl("popover"), foreground: hsl("card-foreground") },
        success: hsl("success"), warning: hsl("warning"),
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)", xl: "calc(var(--radius) + 4px)", "2xl": "calc(var(--radius) + 8px)", "3xl": "calc(var(--radius) + 14px)" },
      fontFamily: { sans: ["var(--font-sans)"], display: ["var(--font-display)"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      boxShadow: { soft: "var(--shadow)", lift: "var(--shadow-lg)" },
      keyframes: { "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } }, "scale-in": { from: { opacity: 0, transform: "scale(.96)" }, to: { opacity: 1, transform: "none" } } },
      animation: { "fade-in": "fade-in .3s cubic-bezier(.2,.8,.2,1) both", "scale-in": "scale-in .2s cubic-bezier(.2,.8,.2,1) both" },
    },
  },
  // stak-ui.css already ships a gentle reset; Tailwind's full preflight would flatten kit headings/buttons.
  corePlugins: { preflight: false, container: false },
});
// The slice of preflight that utilities rely on, scoped to elements that actually use border/divide utilities
// (a global `*{border-width:0}` would erase kit and native control borders). Utilities come later and win ties.
const BASE = `:where([class*="border"],[class*="divide-"]>*){border-width:0;border-style:solid;border-color:hsl(var(--border))}
:where([class*="outline-"]){outline-color:hsl(var(--ring))}
:where(button,input,select,textarea){font:inherit;letter-spacing:inherit}
:where(button,[type=button],[type=submit],[type=reset]){background-color:transparent;background-image:none;border:0;padding:0;cursor:pointer;color:inherit}
:where(button:disabled){cursor:not-allowed}
`;

const sourceOf = (files) => Object.entries(files)
  .filter(([p]) => /\.(html?|js|jsx|ts|tsx)$/.test(p) && !/^stak[\w.-]*\.js$/.test(p))
  .map(([, c]) => String(c || "")).join("\n");

const cache = new Map();
async function compile(files) {
  const src = sourceOf(files);
  const key = crypto.createHash("sha1").update(src).digest("hex");
  if (cache.has(key)) return cache.get(key);
  const r = await postcss([tailwind(CONFIG(src))]).process("@tailwind base;\n@tailwind components;\n@tailwind utilities;", { from: undefined });
  const css = `/* Stak Tailwind build — generated from this project's classes. Do not edit; edit styles.css. */\n${BASE}${r.css}\n`;
  cache.set(key, css);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return css;
}

// Kit-based (free-form) projects get stak-tw.css linked right after stak-ui.css and before styles.css.
// Hand-built templates inline their own CSS and are left untouched.
const usesKit = (files) => Object.entries(files).some(([p, c]) => /\.html?$/.test(p) && /stak-ui\.css/.test(c || ""));
function linkInto(html) {
  if (/stak-tw\.css/.test(html)) return html;
  const tag = `<link rel="stylesheet" href="${FILE}">`;
  if (/<link[^>]+stak-ui\.css[^>]*>/i.test(html)) return html.replace(/(<link[^>]+stak-ui\.css[^>]*>)/i, `$1\n  ${tag}`);
  if (/<link[^>]+styles\.css[^>]*>/i.test(html)) return html.replace(/(<link[^>]+styles\.css[^>]*>)/i, `${tag}\n  $1`);
  return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}
const looksTailwind = (files) => Object.entries(files).some(([p, c]) => /\.html?$/.test(p) && /class="[^"]*\b(items-center|justify-between|px-\d|py-\d|gap-\d|rounded-(lg|xl|2xl)|text-(sm|lg|xl|2xl)|max-w-)\b/.test(c || ""));
async function apply(files, { force } = {}) {
  const out = { ...files };
  delete out[FILE];
  if (!usesKit(out) && !(force && looksTailwind(out))) return out;
  try { out[FILE] = await compile(out); }
  catch (e) { console.warn("[tw]", e.message); return out; }
  for (const p of Object.keys(out)) if (/\.html?$/.test(p)) out[p] = linkInto(out[p]);
  return out;
}

// ---- design lint: classes the markup relies on that no stylesheet defines (invented framework / typos)
const selectorsOf = (css) => new Set([...String(css || "").matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\(.)/g, "$1")));
function undefinedClasses(files, extraCss = "") {
  const css = Object.entries(files).filter(([p]) => p.endsWith(".css")).map(([, c]) => c).join("\n") + extraCss;
  const known = selectorsOf(css);
  const missing = new Map();
  for (const [p, html] of Object.entries(files)) {
    if (!/\.html?$/.test(p)) continue;
    for (const m of String(html).matchAll(/\sclass="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) {
      if (!c || known.has(c) || /[{}$<>\[\]]/.test(c) || /^(js-|is-|has-|active|open|selected|hidden|show|dark|light|current)/.test(c)) continue;
      missing.set(c, (missing.get(c) || 0) + 1);
    }
  }
  return [...missing.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

module.exports = { apply, compile, undefinedClasses, FILE, usesKit };
