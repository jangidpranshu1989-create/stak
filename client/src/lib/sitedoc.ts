// Builder preview: render a generated app in a sandboxed srcdoc iframe (opaque origin).
// Hosting proxies forbid framing /api/site URLs, and srcdoc also guarantees the app can't read Stak sessions.
import { API } from "./api";

export const absApi = () => new URL((API || ".").replace(/\/?$/, "/"), location.href).href.replace(/\/$/, "");
const J = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const KEY = (pid: string) => `stak_site_${pid}`;

export function siteStore(pid: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY(pid)) || "{}") || {}; } catch { return {}; }
}
export function saveSiteStore(pid: string, data: unknown) {
  try { const s = JSON.stringify(data); if (s.length < 1_500_000) localStorage.setItem(KEY(pid), s); } catch { /* storage blocked */ }
}

export async function loadSiteDoc(pid: string, page = "index.html", version?: number): Promise<string> {
  let p = page.split("#")[0].split("?")[0];
  if (!p || p.endsWith("/")) p += "index.html";
  if (p.includes("..")) p = "index.html";
  const root = `${absApi()}/api/site/${pid}/`;
  const res = await fetch(`${root}${p}${version ? `?v=${version}` : ""}`, { headers: { "X-Stak-Raw": "1" }, cache: "no-cache" });
  if (!res.ok) throw new Error(`Preview failed to load (${res.status})`);
  const html = await res.text();
  const dir = (root + p).replace(/[^/]*$/, "");
  const inj = `<base href="${dir.replace(/"/g, "%22")}"><script>window.STAK={project:${J(pid)},api:${J(`${absApi()}/api/rt/${pid}`)}};window.__STAK_STORE__={ls:${J(siteStore(pid))}}</script>`;
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (x) => x + inj) : inj + html;
}
export const validNavPath = (p: unknown): p is string => typeof p === "string" && /^[\w\-./%]*([?#].*)?$/.test(p) && !p.includes("..");
