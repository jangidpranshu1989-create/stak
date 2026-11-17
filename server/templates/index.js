// Template-first generation.
//
// Why: free LLMs writing a whole app from scratch in one shot produce "works-ish, looks meh" results, and Groq free keys
// (8k tokens/min) can't even fit a big repair prompt. Lovable/v0/Bolt all start from a curated design system and starter
// code; we do the same. For the most common archetypes (AI chat, tracker/dashboard, business website) Stak ships a
// hand-built, fully working, mobile-first app and the model only writes a small JSON config (name, persona, fields,
// categories, copy, sample data, colours). Result: SaaS-grade UI every time, ~3k tokens per build, zero broken buttons.
const fs = require("fs");
const path = require("path");
const SITE = require("./site/render");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const SHARED = { css: read("shared/base.css"), icons: read("shared/icons.js"), kit: read("shared/kit.js") };
const T = {
  chat: { html: read("chat/index.html"), css: read("chat/styles.css"), js: read("chat/app.js") },
  tracker: { html: read("tracker/index.html"), css: read("tracker/styles.css"), js: read("tracker/app.js") },
  site: { css: read("site/styles.css"), js: read("site/app.js") },
};
const ICONS = (SHARED.icons.match(/^"?([\w-]+)"?:'/gm) || []).map((s) => s.replace(/["':]/g, ""));

// ---------------------------------------------------------------- archetype detection
const RX = {
  chat: /\b(chat ?bots?|chatbot|ai (assistant|chat|tutor|agent|companion|coach|helper|bot|friend|teacher|doctor|lawyer|advisor|counsel+or)|assistant|gpt|ask (ai|me)|q ?& ?a bot|support bot|doubt (solver|bot)|ai se baat|sawal|jawab|baat kare|talk to (an )?ai)\b/i,
  chatNot: /\b(messenger|chat with (friends|people|users)|group chat|whatsapp clone|chat room|realtime chat between|dm app)\b/i,
  tracker: /\b(track(er|ing)?|expenses?|kharch[ae]?|hisaab|hisab|budget|spend(ing)?|habit|inventory|stock (manager|management)|workout log|fitness log|gym log|attendance|to-?dos?|task(s| list| manager)|notes? app|journal|diary|reading list|book list|crm|leads? (manager|tracker)|contacts? (manager|book)|subscriptions?|bills?|savings|water intake|calorie|mood|study planner|planner|log ?book|bookkeeping|ledger|udhaar|udhar|khata)\b/i,
};
function pick(prompt, kind) {
  if (process.env.STAK_TEMPLATES === "0") return null;
  const s = String(prompt || "");
  if (kind === "site") return "site";
  if (kind !== "app") return null;
  const tr = RX.tracker.test(s), ch = RX.chat.test(s) && !RX.chatNot.test(s);
  if (ch && !tr) return "chat";
  if (tr && !ch) return "tracker";
  if (tr && ch) return s.search(RX.chat) < s.search(RX.tracker) ? "chat" : "tracker";
  return null;
}

// ---------------------------------------------------------------- prompts (small: fit Groq free 8k TPM)
const ACCENTS = "#2563eb (blue, trust/tech), #4f46e5 (indigo, productivity), #0d9488 (teal, health/calm), #16a34a (green, money/eco), #ea580c (orange, food/energy), #e11d48 (rose, beauty/love), #9333ea (purple, creative), #0891b2 (cyan, travel/water), #b45309 (amber-brown, cafe/heritage), #18181b (ink, luxury/minimal)";
const iconList = () => ICONS.filter((n) => !["x", "menu", "copy", "check", "refresh", "trash", "pencil", "search", "panel", "chevron-left", "chevron-right", "chevron-down", "more", "square", "stop", "arrow-up", "upload", "download", "filter", "logout"].includes(n)).join(", ");

const COMMON = (lang) => `Reply with ONLY one JSON object — no markdown fences, no comments, no trailing commas.
All user-facing text in ${lang}. Be specific to THIS product: real names, real copy, no lorem ipsum, no "Feature 1", no emojis.
"accent": pick ONE that fits the subject: ${ACCENTS}. "mode": "light" unless the user asked for dark.
"icon" values must come from this list: ${iconList()}.`;

const PROMPTS = {
  chat: (lang) => `You configure a production AI chat app (ChatGPT-style UI already built: sidebar with history, streaming markdown replies, code blocks, mobile drawer). You only write its config.
${COMMON(lang)}
Schema:
{"name":"2-3 word product name","tagline":"one line under the greeting (max 90 chars)","greeting":"big welcome headline, max 6 words","icon":"…","accent":"#hex","mode":"light|dark",
"placeholder":"composer placeholder","disclaimer":"tiny footer line",
"system":"the assistant's full system prompt, 120-250 words: who it is, expertise, audience, tone, reply language (match the user's language; Hinglish if they write Hinglish), formatting (short paragraphs, bullet lists, tables, code blocks when useful), what to do when unsure, safety boundaries for the domain",
"suggestions":[{"title":"3-5 words","prompt":"full first message a user would send, 8-18 words","icon":"…"}] (exactly 4, varied and genuinely useful; answerable WITHOUT live data - no weather, news, prices, traffic or "today" questions),
"temperature":0.2-0.9}`,
  tracker: (lang, today) => `You configure a production tracker/dashboard app (already built: sidebar + mobile tab bar, stat cards, 6-month bar chart, category donut, grouped list with search/filters/sort, add/edit bottom sheet with validation, undo delete, CSV import/export, dark mode, monthly budget). You only write its config.
${COMMON(lang)}
Today is ${today}.
Schema:
{"id":"kebab-case-id","name":"2-3 word product name","tagline":"one line","icon":"…","accent":"#hex","mode":"light|dark",
"currency":"INR (default; ISO code)","locale":"en-IN","entity":{"one":"Expense","many":"Expenses"},
"fields":[{"key":"camelCase","label":"…","type":"text|money|number|date|time|select|textarea|toggle|email|tel|url","required":true|false,"placeholder":"…","unit":"for number only","options":[{"value":"Food","icon":"…","color":"#hex"}]}],
"roles":{"title":"key of the main text field","amount":"key of the money/number field to total, or null","category":"key of the select to group by, or null","date":"key of the date field","done":"key of a toggle meaning completed, or null"},
"flow":true only if the user tracks BOTH income and expenses (money apps), else false,
"budget": default monthly budget number for spending trackers, else 0,
"seed":[8-12 realistic sample records using the field keys; dates spread over the last 45 days (YYYY-MM-DD); if flow is true include "flow":"income"|"expense"]}
Rules: 3-7 fields; always one date field; category select with 5-9 options, each with a fitting icon and a distinct colour; amounts realistic for India in ₹ unless told otherwise.`,
  site: (lang) => `You write the content config of a premium, conversion-focused website (layout, styles, animations, mobile menu, contact form and map are already built). You only write its config.
${COMMON(lang)}
Schema:
{"name":"business name","tagline":"short","description":"SEO meta description, 140-160 chars","icon":"…","accent":"#hex","mode":"light|dark","style":"classic (serif, warm: food, heritage, wedding) | elegant (luxury serif: salon, hotel, jewellery) | modern (clean sans: tech, agency, clinic, coaching) | bold (big grotesk: gym, events, creative)",
"schemaType":"schema.org type e.g. Restaurant, LocalBusiness, MedicalClinic, ProfessionalService",
"hero":{"eyebrow":"short pill text","title":"punchy headline, 4-9 words","subtitle":"1-2 sentences","primary":{"label":"main CTA","href":"#contact"},"secondary":{"label":"…","href":"#section-id"},"photo":"3-6 word concrete photo subject","badges":["3 short trust points"],"card":{"icon":"…","title":"e.g. Open 7 days · 8am-11pm","body":"short"}},
"sections":[ 4-7 of these, in a smart order, each with "nav" (short menu label) for the 3-5 most important:
 {"type":"features|services","id":"kebab","nav":"…","eyebrow":"…","title":"…","subtitle":"…","items":[{"icon":"…","title":"…","body":"1-2 sentences","price":"optional","photo":"optional photo subject"}]},
 {"type":"menu","id":"menu","nav":"Menu","title":"…","groups":[ 3-4 groups, EACH with 4-6 items: {"name":"Starters","items":[{"name":"…","desc":"…","price":"₹249","tag":"optional e.g. Bestseller"}]}]},
 {"type":"pricing","id":"pricing","nav":"Pricing","title":"…","plans":[{"name":"…","price":"₹999","period":"/month","desc":"…","features":["…"],"featured":true,"cta":"…"}]},
 {"type":"about","id":"about","nav":"About","eyebrow":"…","title":"…","body":"2 short paragraphs separated by \\n","photo":"…","stats":[{"value":"12+","label":"years"}]},
 {"type":"gallery","id":"gallery","title":"…","photos":["4-7 photo subjects"]},
 {"type":"testimonials","title":"…","items":[{"quote":"…","name":"Indian name","role":"…"}]},
 {"type":"stats","items":[{"value":"…","label":"…"}]},
 {"type":"faq","id":"faq","nav":"FAQ","title":"…","items":[{"q":"…","a":"…"}]},
 {"type":"cta","title":"…","subtitle":"…","button":"…"} ],
"contact":{"nav":"Contact","title":"…","subtitle":"…","phone":"+91 …","email":"…","address":"full address incl. city","whatsapp":"+91… or empty","hours":[{"days":"Mon–Fri","time":"10am – 9pm"}],"formTitle":"…","fields":["name","phone","email","date","guests","time","message"] (choose 3-5 that fit),"button":"…"},
"footer":{"note":"one line","socials":{"instagram":"@handle"}}}
Rules: photo subjects are concrete things a stock photo would show ("masala dosa on banana leaf", "modern dental clinic interior"); use details the user gave (city, name, phone) exactly; invent plausible ones otherwise; menu/pricing prices in ₹ for India. Never invent ratings, review counts, awards or "No.1" claims - hero badges must be factual-sounding features (e.g. "Pure veg", "Free Wi-Fi", "Open till 11pm"). Make it feel full and real: rich menu, 6 gallery photos, 3 testimonials, 4-6 FAQs.`,
};

// ---------------------------------------------------------------- validation helpers
const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, n = 200, d = "") => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : d);
const arr = (v, n) => (Array.isArray(v) ? v.filter(Boolean).slice(0, n) : []);
const ic = (v, d = "sparkles") => (ICONS.includes(v) ? v : d);
function lum(hex) { const c = hex.slice(1).match(/../g).map((h) => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const fgFor = (hex) => (lum(hex) > 0.42 ? "#111111" : "#ffffff");
const accent = (v, d) => (HEX.test(v || "") ? v : d);

function normChat(c, ctx) {
  const name = str(c.name, 40, ctx.title || "Assistant");
  const sug = arr(c.suggestions, 4).map((s) => ({ title: str(s.title, 40, "Ask a question"), prompt: str(s.prompt, 200, "Help me with something"), icon: ic(s.icon, "sparkles") }));
  while (sug.length < 4) sug.push([{ title: "Explain simply", prompt: "Explain a tricky concept to me in simple words with an example", icon: "lightbulb" }, { title: "Make a plan", prompt: "Help me make a step-by-step plan for my goal this week", icon: "target" }, { title: "Write for me", prompt: "Write a short, friendly message I can send to my team", icon: "pen" }, { title: "Brainstorm ideas", prompt: "Give me 10 creative ideas and tell me which one is best", icon: "sparkles" }][sug.length]);
  const a = accent(c.accent, "#2563eb");
  return {
    id: str(c.id, 30, "") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30), name, tagline: str(c.tagline, 140, "Ask me anything."), greeting: str(c.greeting, 60, `Hi, I'm ${name}`),
    icon: ic(c.icon), accent: a, accentFg: fgFor(a), mode: c.mode === "dark" ? "dark" : "light", placeholder: str(c.placeholder, 80, `Message ${name}…`), disclaimer: str(c.disclaimer, 120, `${name} can make mistakes. Check important info.`),
    system: str(c.system, 4000, `You are ${name}, a helpful, accurate assistant. ${ctx.prompt || ""}`), suggestions: sug,
    temperature: Math.min(1, Math.max(0, Number(c.temperature) || 0.7)), locale: "en-IN",
  };
}
const TYPES = ["text", "money", "number", "date", "time", "select", "textarea", "toggle", "email", "tel", "url"];
function normTracker(c, ctx) {
  const name = str(c.name, 40, ctx.title || "Tracker");
  let fields = arr(c.fields, 8).map((f) => ({ key: str(f.key, 30, "").replace(/[^\w]/g, ""), label: str(f.label, 40, f.key), type: TYPES.includes(f.type) ? f.type : "text", required: !!f.required, placeholder: str(f.placeholder, 60), unit: str(f.unit, 12), options: f.type === "select" ? arr(f.options, 12).map((o) => (typeof o === "string" ? { value: o.slice(0, 30) } : { value: str(o.value, 30, "Other"), icon: ic(o.icon, "tag"), color: accent(o.color, undefined) })) : undefined })).filter((f) => f.key);
  const seen = new Set(); fields = fields.filter((f) => !seen.has(f.key) && seen.add(f.key));
  if (!fields.length) fields = [{ key: "title", label: "Title", type: "text", required: true }, { key: "date", label: "Date", type: "date", required: true }];
  const has = (k) => k && fields.some((f) => f.key === k);
  const r = c.roles || {};
  const roles = {
    title: has(r.title) ? r.title : (fields.find((f) => f.type === "text") || fields[0]).key,
    amount: has(r.amount) ? r.amount : (fields.find((f) => f.type === "money") || {}).key || null,
    category: has(r.category) ? r.category : (fields.find((f) => f.type === "select") || {}).key || null,
    date: has(r.date) ? r.date : (fields.find((f) => f.type === "date") || {}).key || "date",
    done: has(r.done) ? r.done : null,
  };
  const keys = new Set(fields.map((f) => f.key).concat(["flow"]));
  const seed = arr(c.seed, 14).map((s) => { const o = {}; for (const k of Object.keys(s || {})) if (keys.has(k)) o[k] = typeof s[k] === "string" ? s[k].slice(0, 200) : s[k]; return o; }).filter((o) => o[roles.title]);
  const a = accent(c.accent, "#2563eb");
  return {
    id: str(c.id, 30, "").replace(/[^\w-]/g, "") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30), name, tagline: str(c.tagline, 140), icon: ic(c.icon, "dashboard"), accent: a, accentFg: fgFor(a), mode: c.mode === "dark" ? "dark" : "light",
    currency: /^[A-Z]{3}$/.test(c.currency || "") ? c.currency : "INR", locale: str(c.locale, 10, "en-IN"),
    entity: { one: str(c.entity?.one, 24, "Entry"), many: str(c.entity?.many, 24, "Entries") }, fields, roles, flow: !!c.flow && !!roles.amount, budget: Math.max(0, Number(c.budget) || 0), seed,
  };
}
function normSite(c, ctx) {
  const a = accent(c.accent, "#b45309");
  const out = JSON.parse(JSON.stringify(c || {}));
  out.name = str(c.name, 50, ctx.title || "Our business");
  out.accent = a; out.accentFg = fgFor(a);
  out.icon = ic(c.icon, "sparkles");
  out.style = SITE.FONTS[c.style] ? c.style : "classic";
  out.sections = arr(c.sections, 8);
  for (const s of out.sections) { if (Array.isArray(s.items)) for (const it of s.items) if (it && it.icon) it.icon = ic(it.icon); }
  if (out.hero?.card) out.hero.card.icon = ic(out.hero.card.icon, "star");
  out.lang = ctx.lang === "hi" ? "hi" : "en";
  return out;
}

// ---------------------------------------------------------------- render
const fill = (html, v) => html.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
const configJs = (cfg) => `/* App configuration — edit names, colours, fields and copy here */\nwindow.APP = ${JSON.stringify(cfg, null, 2).replace(/</g, "\\u003c")};\n`;

// Hard-fact guard: web research about a business name often surfaces a same-named place in another city, and models
// happily copy its address. If the user named a city, any other well-known city in the config is swapped for theirs.
const CITIES = ["Delhi", "New Delhi", "Mumbai", "Bengaluru", "Bangalore", "Kolkata", "Chennai", "Hyderabad", "Pune", "Ahmedabad", "Jaipur", "Kota", "Udaipur", "Jodhpur", "Ajmer", "Bikaner", "Lucknow", "Kanpur", "Noida", "Gurugram", "Gurgaon", "Chandigarh", "Indore", "Bhopal", "Surat", "Vadodara", "Nagpur", "Patna", "Ranchi", "Bhubaneswar", "Guwahati", "Kochi", "Coimbatore", "Mysuru", "Mysore", "Visakhapatnam", "Varanasi", "Agra", "Amritsar", "Ludhiana", "Dehradun", "Goa", "Nashik", "Rajkot", "Raipur", "Thane", "Navi Mumbai", "Ghaziabad", "Meerut", "Prayagraj", "Allahabad", "Gwalior", "Jabalpur", "Madurai", "Thiruvananthapuram", "Mangaluru", "Shimla", "Rishikesh", "London", "Dubai", "New York", "Singapore", "Toronto"];
function enforceFacts(cfg, prompt) {
  const p = String(prompt || "");
  const own = CITIES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(p));
  if (!own.length) return cfg;
  const city = own[0], others = CITIES.filter((c) => !own.some((o) => o.toLowerCase() === c.toLowerCase()) && !(city.includes(c) || c.includes(city)));
  const rx = new RegExp(`\\b(${others.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");
  const walk = (v) => typeof v === "string" ? v.replace(rx, city) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(photo|src|href|url|accent)/i.test(k) ? x : walk(x)])) : v;
  return walk(cfg);
}

function render(arch, raw, ctx = {}) {
  raw = enforceFacts(raw || {}, ctx.prompt);
  if (arch === "chat") {
    const cfg = normChat(raw || {}, ctx);
    return { cfg, files: { "index.html": fill(T.chat.html, { TITLE: cfg.name, DESC: cfg.tagline, MODE: cfg.mode, LANG: ctx.lang === "hi" ? "hi" : "en" }), "styles.css": SHARED.css + "\n" + T.chat.css, "config.js": configJs(cfg), "icons.js": SHARED.icons, "kit.js": SHARED.kit, "app.js": T.chat.js } };
  }
  if (arch === "tracker") {
    const cfg = normTracker(raw || {}, ctx);
    return { cfg, files: { "index.html": fill(T.tracker.html, { TITLE: cfg.name, DESC: cfg.tagline, MODE: cfg.mode, LANG: ctx.lang === "hi" ? "hi" : "en" }), "styles.css": SHARED.css + "\n" + T.tracker.css, "config.js": configJs(cfg), "icons.js": SHARED.icons, "kit.js": SHARED.kit, "app.js": T.tracker.js } };
  }
  if (arch === "site") {
    const cfg = normSite(raw || {}, ctx);
    const r = SITE.render(cfg);
    const files = { "index.html": r.html, "styles.css": SHARED.css + "\n" + T.site.css, "config.js": configJs({ id: (cfg.name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30), accentFg: cfg.accentFg, text: r.text }), "icons.js": SHARED.icons, "kit.js": SHARED.kit, "app.js": T.site.js };
    if (r.rules) files["stak.rules.json"] = r.rules;
    return { cfg, files };
  }
  return null;
}

const LABEL = { chat: "AI chat app", tracker: "tracker dashboard", site: "business website" };
const SUMMARY = {
  chat: (c) => `**${c.name}** is ready — a full AI chat app with conversation history, streaming answers with markdown and code blocks, and a mobile-friendly layout. Try one of the suggestions to see it in action.`,
  tracker: (c) => `**${c.name}** is ready — add ${c.entity.many.toLowerCase()} in seconds, see monthly totals, charts and category breakdowns, filter and search, and export to CSV. It works great on mobile too.`,
  site: (c) => `**${c.name}**'s website is ready — a polished, mobile-first site with ${(c.sections || []).length} sections, real photos, a working contact form and a map.`,
};

module.exports = { pick, render, enforceFacts, PROMPTS, LABEL, SUMMARY, ICONS, normChat, normTracker, normSite };
