// Business / landing website renderer: config JSON -> static, SEO-friendly index.html (+ shared styles/app).
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attr = esc;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "section";
const icon = (n, size = 20) => `<span class="i" data-icon="${attr(n || "sparkles")}" data-size="${size}"></span>`;
const photo = (q, alt, cls = "", w = 1200, h = 800, eager = false) => (q ? `<img class="${cls}" src="photo:${attr(String(q).replace(/^photo:/, "").slice(0, 60))}" alt="${attr(alt || q)}" width="${w}" height="${h}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : "");

const FONTS = {
  classic: { display: "Fraunces", q: "Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700", tracking: "-0.02em", weight: 600 },
  elegant: { display: "Cormorant Garamond", q: "Cormorant+Garamond:wght@500;600;700", tracking: "-0.01em", weight: 600 },
  modern: { display: "Geist", q: "", tracking: "-0.04em", weight: 650 },
  bold: { display: "Bricolage Grotesque", q: "Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800", tracking: "-0.035em", weight: 750 },
};

function section(s, i, ctx) {
  const id = s.id || slug(s.nav || s.title || s.type);
  const head = (center = false) => (s.title ? `<div class="sec-head${center ? " center" : ""} reveal">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ""}<h2>${esc(s.title)}</h2>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ""}</div>` : "");
  const alt = i % 2 ? " alt" : "";
  switch (s.type) {
    case "features":
    case "services": {
      const items = (s.items || []).slice(0, 8);
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}<div class="feat-grid n${Math.min(4, items.length > 4 ? (items.length % 3 === 0 ? 3 : 4) : items.length)}">${items.map((it) => `<article class="feat reveal">${it.photo ? photo(it.photo, it.title, "feat-img", 800, 560) : `<div class="feat-ic">${icon(it.icon, 22)}</div>`}<h3>${esc(it.title)}</h3><p>${esc(it.body || it.desc)}</p>${it.price ? `<div class="feat-price">${esc(it.price)}</div>` : ""}</article>`).join("")}</div></div></section>`;
    }
    case "menu":
    case "pricing-list": {
      const groups = (s.groups || [{ name: "", items: s.items || [] }]).slice(0, 6);
      const tabs = groups.length > 1 ? `<div class="tabs reveal" role="tablist">${groups.map((g, k) => `<button role="tab" class="tab${k ? "" : " on"}" data-tab="${k}" aria-selected="${!k}">${esc(g.name)}</button>`).join("")}</div>` : "";
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}${tabs}${groups.map((g, k) => `<div class="menu${k ? " hidden" : ""}" data-panel="${k}">${(g.items || []).slice(0, 14).map((it) => `<article class="dish reveal">${it.photo ? photo(it.photo, it.name, "dish-img", 320, 320) : ""}<div class="dish-m"><div class="dish-top"><h3>${esc(it.name)}</h3><span class="dots"></span><span class="price">${esc(it.price)}</span></div>${it.desc ? `<p>${esc(it.desc)}</p>` : ""}${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ""}</div></article>`).join("")}</div>`).join("")}</div></section>`;
    }
    case "pricing": {
      const plans = (s.plans || s.items || []).slice(0, 4);
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}<div class="plans n${plans.length}">${plans.map((p) => `<article class="plan reveal${p.featured ? " featured" : ""}">${p.featured ? `<span class="plan-badge">${esc(p.badge || "Popular")}</span>` : ""}<h3>${esc(p.name)}</h3><div class="plan-price">${esc(p.price)}<span>${esc(p.period || "")}</span></div><p>${esc(p.desc || "")}</p><ul>${(p.features || []).slice(0, 8).map((f) => `<li>${icon("check", 16)}${esc(f)}</li>`).join("")}</ul><a class="btn ${p.featured ? "btn-primary" : "btn-secondary"} btn-lg" href="${attr(p.href || "#contact")}">${esc(p.cta || ctx.cta)}</a></article>`).join("")}</div></div></section>`;
    }
    case "gallery": {
      const ph = (s.photos || []).slice(0, 8);
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}<div class="gallery">${ph.map((p, k) => `<figure class="g${k === 0 ? " big" : ""} reveal">${photo(p, p, "", 900, 900)}</figure>`).join("")}</div></div></section>`;
    }
    case "about": {
      return `<section class="sec${alt}" id="${id}"><div class="wrap about">${s.photo ? `<div class="about-img reveal">${photo(s.photo, s.title, "", 1000, 1100)}</div>` : ""}<div class="about-m reveal">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ""}<h2>${esc(s.title)}</h2>${String(s.body || "").split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}${(s.stats || []).length ? `<div class="stats">${s.stats.slice(0, 4).map((x) => `<div><b>${esc(x.value)}</b><span>${esc(x.label)}</span></div>`).join("")}</div>` : ""}</div></div></section>`;
    }
    case "testimonials": {
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}<div class="quotes">${(s.items || []).slice(0, 6).map((q) => `<figure class="quote reveal"><div class="stars">${icon("star", 15).repeat(5)}</div><blockquote>${esc(q.quote)}</blockquote><figcaption><span class="q-av">${esc(String(q.name || "?").trim().charAt(0))}</span><span><b>${esc(q.name)}</b>${q.role ? `<span>${esc(q.role)}</span>` : ""}</span></figcaption></figure>`).join("")}</div></div></section>`;
    }
    case "team": {
      return `<section class="sec${alt}" id="${id}"><div class="wrap">${head(true)}<div class="feat-grid n${Math.min(4, (s.items || []).length)}">${(s.items || []).slice(0, 8).map((m) => `<article class="member reveal">${photo(m.photo || "portrait professional", m.name, "", 600, 700)}<h3>${esc(m.name)}</h3><p>${esc(m.role)}</p></article>`).join("")}</div></div></section>`;
    }
    case "faq": {
      return `<section class="sec${alt}" id="${id}"><div class="wrap narrow">${head(true)}<div class="faq">${(s.items || []).slice(0, 10).map((f) => `<details class="reveal"><summary>${esc(f.q)}${icon("plus", 18)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></div></section>`;
    }
    case "cta": {
      return `<section class="sec cta-sec" id="${id}"><div class="wrap"><div class="cta reveal"><h2>${esc(s.title)}</h2>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ""}<a class="btn btn-lg cta-btn" href="${attr(s.href || "#contact")}">${esc(s.button || ctx.cta)}${icon("arrow-right", 18)}</a></div></div></section>`;
    }
    case "stats": {
      return `<section class="sec${alt} slim" id="${id}"><div class="wrap"><div class="band reveal">${(s.items || []).slice(0, 4).map((x) => `<div><b>${esc(x.value)}</b><span>${esc(x.label)}</span></div>`).join("")}</div></div></section>`;
    }
    default:
      return "";
  }
}

function contactSec(c, ctx) {
  if (!c) return "";
  const rows = [];
  if (c.address) rows.push(`<a class="ci" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon("pin")}<span><b>${esc(ctx.t.visit)}</b>${esc(c.address)}</span></a>`);
  if (c.phone) rows.push(`<a class="ci" href="tel:${attr(String(c.phone).replace(/[^\d+]/g, ""))}">${icon("phone")}<span><b>${esc(ctx.t.call)}</b>${esc(c.phone)}</span></a>`);
  if (c.email) rows.push(`<a class="ci" href="mailto:${attr(c.email)}">${icon("mail")}<span><b>${esc(ctx.t.email)}</b>${esc(c.email)}</span></a>`);
  const hours = (c.hours || []).length ? `<div class="hours"><h3>${icon("clock", 18)}${esc(ctx.t.hours)}</h3>${c.hours.slice(0, 8).map((h) => `<div><span>${esc(h.days)}</span><span>${esc(h.time)}</span></div>`).join("")}</div>` : "";
  const fields = (c.fields || ["name", "phone", "message"]).slice(0, 6);
  const F = { name: ["text", ctx.t.name, "name"], phone: ["tel", ctx.t.phone, "tel"], email: ["email", ctx.t.emailF, "email"], date: ["date", ctx.t.date, "off"], guests: ["number", ctx.t.guests, "off"], time: ["time", ctx.t.time, "off"], message: ["textarea", ctx.t.message, "off"] };
  const form = c.form === false ? "" : `<form class="lead-form card" id="leadForm" novalidate><h3>${esc(c.formTitle || ctx.t.formTitle)}</h3>${fields.map((k) => { const [type, label, ac] = F[k] || ["text", k, "off"]; const req = k === "name" || k === "phone" ? " required" : ""; return type === "textarea" ? `<label class="field"><span class="label">${esc(label)}</span><textarea class="textarea" name="${k}" rows="3"${req}></textarea></label>` : `<label class="field"><span class="label">${esc(label)}</span><input class="input" name="${k}" type="${type}" autocomplete="${ac}"${type === "number" ? ' min="1" inputmode="numeric"' : ""}${req}></label>`; }).join("")}<button class="btn btn-primary btn-lg" type="submit">${esc(c.button || ctx.cta)}</button><p class="form-note hidden" id="formNote" role="status"></p></form>`;
  const map = c.address && c.map !== false ? `<div class="map reveal"><iframe title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(c.address)}&z=15&output=embed"></iframe></div>` : "";
  return `<section class="sec alt" id="contact"><div class="wrap">${c.title ? `<div class="sec-head center reveal"><h2>${esc(c.title)}</h2>${c.subtitle ? `<p>${esc(c.subtitle)}</p>` : ""}</div>` : ""}<div class="contact"><div class="contact-info reveal">${rows.join("")}${hours}</div>${form}</div>${map}</div></section>`;
}

function render(cfg) {
  const font = FONTS[cfg.style] || FONTS.classic;
  const t = Object.assign({ visit: "Visit us", call: "Call", email: "Email", hours: "Opening hours", name: "Your name", phone: "Phone", emailF: "Email", date: "Date", guests: "Guests", time: "Time", message: "Message", formTitle: "Send us a message", thanks: "Thank you! We will get back to you shortly.", sending: "Sending…", error: "Could not send. Please call us instead.", menu: "Menu", required: "Please fill in your name and phone", rights: "All rights reserved" }, cfg.text || {});
  const hero = cfg.hero || {};
  const cta = hero.primary?.label || "Contact us";
  const ctx = { t, cta };
  const sections = (cfg.sections || []).filter((s) => s && s.type);
  const navItems = sections.filter((s) => s.nav).slice(0, 5).map((s) => ({ id: s.id || slug(s.nav || s.title || s.type), label: s.nav }));
  if (cfg.contact) navItems.push({ id: "contact", label: cfg.contact.nav || "Contact" });
  const wa = cfg.contact?.whatsapp ? String(cfg.contact.whatsapp).replace(/[^\d]/g, "") : "";
  const socials = Object.entries(cfg.footer?.socials || {}).filter(([, v]) => v).slice(0, 4);
  const year = new Date().getFullYear();
  const fontsHref = `https://fonts.googleapis.com/css2?${font.q ? `family=${font.q}&` : ""}family=Geist:wght@400;500;600;700&display=swap`;
  const ld = { "@context": "https://schema.org", "@type": cfg.schemaType || "LocalBusiness", name: cfg.name, description: cfg.description || hero.subtitle, telephone: cfg.contact?.phone, email: cfg.contact?.email, address: cfg.contact?.address };

  const html = `<!doctype html>
<html lang="${attr(cfg.lang || "en")}" data-theme="${cfg.mode === "dark" ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(cfg.name)}${cfg.tagline ? ` — ${esc(cfg.tagline)}` : ""}</title>
<meta name="description" content="${attr(cfg.description || hero.subtitle || cfg.tagline || "")}">
<meta property="og:title" content="${attr(cfg.name)}"><meta property="og:description" content="${attr(cfg.description || hero.subtitle || "")}"><meta property="og:type" content="website">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontsHref}" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<style>:root{ --accent: ${attr(cfg.accent || "#b45309")}; --display: "${font.display}", Georgia, serif; --d-track: ${font.tracking}; --d-weight: ${font.weight}; }</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script src="config.js"></script>
<script src="icons.js"></script>
<script src="kit.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="hdr" id="hdr">
  <div class="wrap hdr-in">
    <a class="logo" href="#top" aria-label="${attr(cfg.name)}"><span class="logo-mark">${icon(cfg.icon || "sparkles", 16)}</span><span>${esc(cfg.name)}</span></a>
    <nav class="links" aria-label="Main">${navItems.map((n) => `<a href="#${n.id}">${esc(n.label)}</a>`).join("")}</nav>
    <div class="hdr-r"><a class="btn btn-primary btn-sm hdr-cta" href="${attr(hero.primary?.href || "#contact")}">${esc(cta)}</a><button class="icon-btn burger" id="burger" aria-label="${attr(t.menu)}" aria-expanded="false">${icon("menu", 20)}</button></div>
  </div>
  <div class="drawer" id="drawer">${navItems.map((n) => `<a href="#${n.id}">${esc(n.label)}</a>`).join("")}<a class="btn btn-primary btn-lg" href="${attr(hero.primary?.href || "#contact")}">${esc(cta)}</a></div>
</header>
<main id="main">
<section class="hero" id="top">
  <div class="wrap hero-in">
    <div class="hero-m">
      ${hero.eyebrow ? `<span class="eyebrow pill">${esc(hero.eyebrow)}</span>` : ""}
      <h1>${esc(hero.title || cfg.name)}</h1>
      ${hero.subtitle ? `<p class="lead">${esc(hero.subtitle)}</p>` : ""}
      <div class="hero-cta"><a class="btn btn-primary btn-lg" href="${attr(hero.primary?.href || "#contact")}">${esc(cta)}${icon("arrow-right", 18)}</a>${hero.secondary?.label ? `<a class="btn btn-secondary btn-lg" href="${attr(hero.secondary.href || "#")}">${esc(hero.secondary.label)}</a>` : ""}</div>
      ${(hero.badges || []).length ? `<ul class="badges">${hero.badges.slice(0, 3).map((b) => `<li>${icon("check-circle", 16)}${esc(b)}</li>`).join("")}</ul>` : ""}
    </div>
    ${hero.photo ? `<div class="hero-img">${photo(hero.photo, cfg.name, "", 1200, 1400, true)}${hero.card ? `<div class="hero-card">${icon(hero.card.icon || "star", 18)}<span><b>${esc(hero.card.title)}</b>${esc(hero.card.body || "")}</span></div>` : ""}</div>` : ""}
  </div>
</section>
${sections.map((s, i) => section(s, i, ctx)).join("\n")}
${contactSec(cfg.contact, ctx)}
</main>
<footer class="ftr">
  <div class="wrap ftr-in">
    <div><a class="logo" href="#top"><span class="logo-mark">${icon(cfg.icon || "sparkles", 16)}</span><span>${esc(cfg.name)}</span></a><p>${esc(String(cfg.footer?.note || cfg.tagline || "").replace(/©\s*\d{4}[^.]*\.?\s*/g, "").replace(/all rights reserved\.?/i, "").trim() || cfg.tagline || "")}</p></div>
    <nav>${navItems.map((n) => `<a href="#${n.id}">${esc(n.label)}</a>`).join("")}</nav>
    <div class="soc">${socials.map(([k, v]) => `<a href="${attr(/^https?:/.test(v) ? v : `https://${k}.com/${String(v).replace(/^@/, "")}`)}" target="_blank" rel="noopener" aria-label="${attr(k)}">${icon(k === "instagram" ? "instagram" : k === "whatsapp" ? "chat" : "globe", 18)}</a>`).join("")}</div>
  </div>
  <div class="wrap ftr-b">© ${year} ${esc(cfg.name)}. ${esc(t.rights)}.</div>
</footer>
${wa ? `<a class="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon("chat", 24)}</a>` : ""}
<script src="app.js" defer></script>
</body>
</html>
`;
  const rules = cfg.contact && cfg.contact.form !== false ? JSON.stringify({ collections: { leads: { read: "admin", create: "public", update: "admin", delete: "admin" } } }, null, 2) : null;
  return { html, rules, text: t };
}

module.exports = { render, FONTS };
