// Intent router — decides WHAT the user wants built before any prompt is chosen.
// This is the fix for "I asked for a chatbot and got a chatbot landing page":
// every downstream step (questions, blueprint, build prompt, QA) is selected by `kind`.
//
// kinds:
//   app   — an interactive product the user USES (chatbot, todo, CRM, dashboard, tracker, notes, booking system)
//   tool  — a single-purpose utility (calculator, converter, QR/password generator, timer, image compressor)
//   game  — something you play (snake, quiz, memory, puzzle, 2048, typing test)
//   site  — something you READ / a marketing presence (landing page, portfolio, business website, blog, event page)

const RULES = [
  // explicit "website/landing" wording wins only when the user is clearly asking for a marketing/info page
  { kind: "site", w: 6, re: /\b(landing ?page|marketing (site|page)|home ?page|portfolio( site| website)?|company (site|website)|business (site|website)|personal (site|website)|wedding (site|website)|event (page|site)|coming soon|waitlist page|brochure|one[- ]pager|agency (site|website)|resume (site|website)|blog)\b/i },
  { kind: "site", w: 3, re: /\b(website|web ?site|site)\b.*\b(for (my|our|a)|of (my|our))\b/i },
  { kind: "site", w: 3, re: /\b(restaurant|cafe|café|bakery|salon|clinic|hotel|gym|studio|school|coaching|shop|store|boutique|agency|startup|ngo|church|temple)\b.*\b(website|site|page)\b/i },
  { kind: "site", w: 2, re: /वेबसाइट|लैंडिंग|website banao|website bana|site banao|site bana/i },

  { kind: "game", w: 6, re: /\b(game|games|snake|tetris|2048|sudoku|chess|tic[- ]?tac[- ]?toe|flappy|pong|breakout|platformer|arcade|puzzle|memory match|quiz game|trivia|wordle|hangman|minesweeper|typing (test|game)|racing|shooter|rpg)\b|गेम|khel/i },

  { kind: "tool", w: 5, re: /\b(calculator|converter|convert|generator|qr( code)?|barcode|password|timer|stopwatch|countdown|pomodoro|unit|bmi|emi|loan|interest|tip|currency|color picker|colour picker|palette|json (formatter|viewer)|formatter|minifier|beautifier|regex|base64|hash|uuid|lorem|word count|character count|compress(or)?|resize(r)?|cropper|image editor|pdf (merger|tool)|markdown (editor|preview)|text (tool|editor)|translator|dictionary|stopwatch|metronome|tuner|random (picker|number)|spin(ner)? wheel|dice|age calculator|percentage|gst|invoice generator|signature)\b|कैलकुलेटर|converter banao/i },

  { kind: "app", w: 6, re: /\b(chat ?bot|chatbot|ai (assistant|chat|tutor|agent|companion)|assistant app|chat app|messenger|todo|to-do|task (app|manager|tracker)|kanban|crm|erp|inventory|dashboard|admin panel|tracker|habit|expense|budget|finance app|notes? app|note[- ]taking|journal app|diary app|booking (app|system)|appointment (app|system)|reservation system|attendance|hrms|pos\b|point of sale|billing (app|software)|lms|quiz app|flashcards?|recipe app|workout app|fitness app|social (app|network)|forum|marketplace app|e-?commerce app|saas|web app|webapp|mobile app|pwa|portal|management (system|app)|system for)\b|ऐप|app banao|app bana/i },
  { kind: "app", w: 2, re: /\b(app|application|platform|software|system)\b/i },
];

// light-weight scoring, used instantly (no model call) and as a tie-breaker for the model's own guess
function classify(prompt) {
  const s = String(prompt || "");
  const score = { app: 0, tool: 0, game: 0, site: 0 };
  const signals = [];
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) { score[r.kind] += r.w; signals.push(`${r.kind}:${m[0].trim().slice(0, 30)}`); }
  }
  // "landing page FOR my app" is still a site; "app WITH a landing page" is still an app
  if (/\blanding ?page\b/i.test(s) && /\b(for|of)\b[^.]{0,40}\b(app|chatbot|saas|tool|product|startup)\b/i.test(s)) score.site += 6;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  const second = ranked[1][1];
  if (!topScore) return { kind: "app", confidence: 0.35, signals, scores: score }; // unknown: a working product beats a brochure
  const confidence = Math.min(0.98, 0.5 + (topScore - second) / 12);
  return { kind: top, confidence: Math.round(confidence * 100) / 100, signals, scores: score };
}

const KINDS = ["app", "tool", "game", "site"];
const normKind = (k) => (KINDS.includes(String(k || "").toLowerCase()) ? String(k).toLowerCase() : null);

// merge the heuristic with the model's opinion (model wins unless the heuristic is very sure)
function decide(prompt, modelKind) {
  const h = classify(prompt);
  const m = normKind(modelKind);
  if (!m) return h;
  if (m === h.kind) return { ...h, confidence: Math.max(h.confidence, 0.9), source: "both" };
  if (h.confidence >= 0.85) return { ...h, source: "rules" };
  return { kind: m, confidence: 0.75, signals: h.signals, scores: h.scores, source: "model" };
}

const LABELS = {
  app: { en: "Web app", hinglish: "Web app", hi: "वेब ऐप" },
  tool: { en: "Utility tool", hinglish: "Utility tool", hi: "यूटिलिटी टूल" },
  game: { en: "Game", hinglish: "Game", hi: "गेम" },
  site: { en: "Website", hinglish: "Website", hi: "वेबसाइट" },
};

module.exports = { classify, decide, normKind, KINDS, LABELS };
