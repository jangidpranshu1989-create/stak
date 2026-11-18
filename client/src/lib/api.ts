// Stak API client. Session token lives in memory (+ HttpOnly cookie set by the server).
// A per-tab visitor id (kept in window.name) lets a guest session survive reloads on hosts that block storage.

declare global {
  interface Window { __API_BASE__?: string }
}

function resolveBase(): string {
  const b = typeof window !== "undefined" ? window.__API_BASE__ || "" : "";
  if (b && !b.startsWith("__")) return b.replace(/\/+$/, "");
  return ""; // same origin (server serves the built client) or Vite dev proxy
}
export const API = resolveBase();

function visitorId(): string {
  const KEY = "stak_vid:";
  try {
    const m = String(window.name || "").match(/stak_vid:([a-z0-9]{20,64})/);
    if (m) return m[1];
  } catch { /* ignore */ }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
  try {
    // keep other window.name content intact
    window.name = String(window.name || "").includes(KEY) ? window.name : `${window.name ? window.name + "|" : ""}${KEY}${id}`;
  } catch { /* ignore */ }
  return id;
}
export const VISITOR = visitorId();

// Signed-in sessions survive reloads (and the Android app) via localStorage when the host allows it.
const TK = "stak_token";
let token: string | null = (() => { try { return localStorage.getItem(TK); } catch { return null; } })();
export const setToken = (t: string | null) => {
  token = t;
  try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch { /* storage blocked */ }
  native()?.setSession({ token: t || "", api: new URL(API || "/", location.href).href.replace(/\/$/, "") }).catch(() => {});
};
// Capacitor bridge (Android app): lets the widget, live tracker and background sync use this session.
export function native(): any {
  try { const c = (window as any).Capacitor; return c?.isNativePlatform?.() ? c.Plugins?.StakNative || null : null; } catch { return null; }
}
export const isNative = () => !!native();
export const getToken = () => token;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(method: string, path: string, body?: unknown, extra: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Visitor-Id": VISITOR };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", ...extra });
  } catch {
    throw new ApiError("Can't reach the Stak server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) throw new ApiError(data?.message || `Request failed (${res.status})`, res.status);
  return data as T;
}

export const siteUrl = (pid: string, v?: number) => `${API || location.origin}/api/site/${pid}/${v ? `?v=${v}` : ""}`;
export const zipUrl = (pid: string) => `${API || location.origin}/api/dl/${pid}/site.zip?api=${encodeURIComponent(`${API || location.origin}/api/rt/${pid}`)}`;

// ---------- types
export type Kind = "app" | "tool" | "game" | "site";
export interface User { id: string; name: string; email: string | null; guest: boolean; lang: string; created: number }
export interface ProjectLite { id: string; title: string; prompt: string; lang: string; stage: string; version: number; kind: Kind; created: number; updated: number; running?: boolean }
export interface Project extends ProjectLite { files: Record<string, string>; blueprint?: Blueprint | null; rules?: Rules | null }
export interface Blueprint { name?: string; oneLiner?: string; features?: string[]; acceptance?: string[]; data?: { collection: string; fields?: string[] }[]; screens?: any[]; design?: any }
export interface Rules { collections: Record<string, Partial<Record<"read" | "create" | "update" | "delete", Access>>> }
export type Access = "public" | "auth" | "owner" | "admin";
export interface Question { id: string; type: "single" | "multi" | "text" | "secret" | "images"; question: string; options?: string[]; placeholder?: string; secretName?: string; helpUrl?: string; optional?: boolean; max?: number; slot?: string; aiNote?: string }
export interface Step { id: string; label: string; status: "running" | "done" | "error" | "skip"; ms?: number; detail?: string }
export interface Usage { prompt: number; completion: number; calls: number }
export interface Report {
  kind?: Kind; duration?: number; models?: string[]; usage?: Usage; steps?: Step[];
  qa?: { found: number; repaired: number; autoFixed: number; rounds: number; remaining: string[] };
  security?: { score: number; label: string; issues: { file: string; severity: string; problem: string; fix?: string }[] };
  review?: { checks: { check: string; pass: boolean; why: string }[]; passed: number; total: number; score: number | null };
  sources?: { title: string; url: string }[]; notes?: string[]; version?: number;
  photos?: { query: string; title: string; license: string; author: string; page: string }[];
}
export interface Message { id: number; projectId: string; role: "user" | "assistant"; kind: "text" | "questions" | "answers" | "build" | "edit"; content: string; meta: any; created: number }
export interface Version { n: number; label: string; created: number }
export interface JobView {
  status: "running" | "done" | "error" | "stopped" | "gone" | "queued"; phase?: string; delta?: string; doneFiles?: string[]; type?: string; elapsed?: number;
  error?: string; model?: string; plan?: string; blueprint?: Blueprint; kind?: Kind; sources?: any[]; notes?: string[]; steps?: Step[]; usage?: Usage; report?: Report;
}
export interface Intent { kind: Kind; confidence: number; signals: string[]; label: Record<string, string> }
