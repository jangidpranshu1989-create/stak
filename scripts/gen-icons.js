// Dev tool: builds server/runtime/icons.json (Lucide, ISC) for the hosted `stak-ui.js` icon helper.
// node scripts/gen-icons.js   (needs client/node_modules/lucide-react)
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "../client/node_modules/lucide-react/dist/esm/icons");
const NAMES = `activity alarm-clock alert-circle alert-triangle archive arrow-down arrow-left arrow-right arrow-up arrow-up-right at-sign award badge-check ban bar-chart-3 battery bell bell-off bike book book-open bookmark bot box briefcase brush bug building calculator calendar calendar-days calendar-check camera car chart-line chart-pie check check-circle-2 chevron-down chevron-left chevron-right chevron-up chevrons-up-down circle circle-check circle-help circle-plus circle-x clipboard clipboard-check clock cloud cloud-sun code coffee cog coins compass copy cpu credit-card crown dice-5 dollar-sign download droplet droplets dumbbell edit egg euro external-link eye eye-off fast-forward file file-text film filter fingerprint flag flame flask-conical folder folder-open gamepad-2 gauge gift git-branch glasses globe graduation-cap grid-3x3 grip-vertical hammer hand hash headphones heart heart-pulse help-circle history home hourglass image inbox indian-rupee info key keyboard laptop layers layout-dashboard layout-grid leaf library lightbulb link list list-checks list-todo loader-circle lock log-in log-out mail map map-pin maximize medal megaphone menu message-circle message-square mic minimize minus monitor moon more-horizontal more-vertical mountain mouse-pointer-click move music navigation newspaper notebook-pen package paint-bucket palette paperclip pause pen pencil percent phone pie-chart pin pizza plane play plus pocket power printer puzzle qr-code quote radio receipt redo-2 refresh-cw repeat rocket rotate-ccw rotate-cw ruler save scale scan school search send settings settings-2 share-2 shield shield-check shirt shopping-bag shopping-cart shuffle sidebar skip-back skip-forward slash sliders-horizontal smartphone smile sparkles speaker square square-check star stethoscope stop-circle store sun sunrise sunset table tag target tent terminal thermometer thumbs-up ticket timer timer-reset toggle-left toggle-right train-front trash-2 tree-pine trending-down trending-up trophy truck tv type umbrella undo-2 upload user user-plus users utensils video volume-1 volume-2 volume-x wallet wand-sparkles watch waves wifi wind wrench x zap zoom-in zoom-out`.split(/\s+/);
const ALIAS = { trash: "trash-2", "check-circle": "circle-check", "x-circle": "circle-x", settings2: "settings-2", refresh: "refresh-cw", undo: "undo-2", redo: "redo-2", rupee: "indian-rupee", dashboard: "layout-dashboard", grid: "layout-grid", "bar-chart": "bar-chart-3", chart: "chart-line", pie: "pie-chart", help: "circle-help", loader: "loader-circle", spinner: "loader-circle", "volume": "volume-2", mute: "volume-x", reset: "rotate-ccw", dice: "dice-5", gamepad: "gamepad-2", share: "share-2", sliders: "sliders-horizontal", wand: "wand-sparkles", more: "more-horizontal", stop: "stop-circle", message: "message-circle", chat: "message-square", "pen-line": "notebook-pen", edit: "pencil", todo: "list-todo", tree: "tree-pine", train: "train-front", flask: "flask-conical", "grid-3": "grid-3x3" };
const out = {};
const attrs = (o) => Object.entries(o).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ");
for (const n of NAMES) {
  const f = path.join(DIR, n + ".js");
  if (!fs.existsSync(f)) { console.warn("missing", n); continue; }
  let src = fs.readFileSync(f, "utf8"), m, hops = 0;
  while (!(m = src.match(/createLucideIcon\("[^"]+",\s*(\[[\s\S]*?\])\);/)) && hops++ < 3) {
    const r = src.match(/from ['"]\.\/([\w-]+)\.js['"]/);
    if (!r) break;
    src = fs.readFileSync(path.join(DIR, r[1] + ".js"), "utf8");
  }
  if (!m) { console.warn("unparsed", n); continue; }
  const nodes = Function(`return ${m[1]}`)();
  out[n] = nodes.map(([t, a]) => `<${t} ${attrs(a)}/>`).join("");
}
for (const [a, t] of Object.entries(ALIAS)) if (out[t] && !out[a]) out[a] = t;
fs.writeFileSync(path.join(__dirname, "../server/runtime/icons.json"), JSON.stringify(out));
// full set: only icons a project actually references get bundled into its stak-ui.js (see site.js iconsFor)
const all = {};
for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith(".js")) continue;
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  const m = src.match(/createLucideIcon\("[^"]+",\s*(\[[\s\S]*?\])\);/);
  if (m) all[file.slice(0, -3)] = Function(`return ${m[1]}`)().map(([t, a]) => `<${t} ${attrs(a)}/>`).join("");
  else { const r = src.match(/from ['"]\.\/([\w-]+)\.js['"]/); if (r) all[file.slice(0, -3)] = "@" + r[1]; }
}
for (const [k, v] of Object.entries(all)) if (v[0] === "@") { const t = all[v.slice(1)]; if (t && t[0] !== "@") all[k] = t; else delete all[k]; }
for (const [a, t] of Object.entries(ALIAS)) if (all[t] && !all[a]) all[a] = all[t];
fs.writeFileSync(path.join(__dirname, "../server/runtime/icons-all.json"), JSON.stringify(all));
console.log(Object.keys(all).length, "icons in full set");
console.log(Object.keys(out).length, "icons", JSON.stringify(out).length, "bytes");
