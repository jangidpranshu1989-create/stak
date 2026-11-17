// Real-time layer: polls the compact mobile summary + event log (3 s when visible, 20 s in background),
// raises in-app toasts and system notifications, keeps the Android widget/live tracker in sync,
// (inside the Android app the native tracker owns system notifications, so they never double up)
// and manages Web Push (works when the tab or the installed PWA is closed).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, API, native, isNative } from "./api";
import { useSession } from "./session";
import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";

export interface ActiveJob { jobId: string; projectId: string; title: string; type: string; phase: string; elapsed: number; progress: number; model?: string }
export interface Summary {
  stats: { projects: number; building: number; ready: number; needsAnswers: number };
  active: ActiveJob[]; pending: { projectId: string; title: string; count: number }[];
  recent: { id: string; title: string; stage: string; running: boolean; updated: number; version: number }[];
}
interface LiveEvent { id: number; type: string; projectId: string; title: string; body: string; created: number }
type Perm = "granted" | "denied" | "default" | "unsupported";
interface Live { summary: Summary | null; perm: Perm; enable: () => Promise<Perm>; refresh: () => void }
const Ctx = createContext<Live | null>(null);

export const PHASE_LABEL: Record<string, string> = {
  queued: "Queued", questions: "Preparing questions", blueprint: "Planning", research: "Researching", context: "Reading context",
  build: "Writing code", template: "Designing", photos: "Adding photos", qa: "Testing", review: "Reviewing", repair1: "Fixing issues", repair2: "Fixing issues", publish: "Publishing",
};
const EVENT_TEXT: Record<string, (e: LiveEvent) => { title: string; body: string }> = {
  build_done: (e) => ({ title: `${e.title} is ready`, body: e.body || "Your build finished" }),
  edit_done: (e) => ({ title: `${e.title} updated`, body: e.body || "Your edit is live" }),
  questions_ready: (e) => ({ title: `${e.title}: quick questions`, body: "Answer them to start the build" }),
  job_failed: (e) => ({ title: `${e.title}: build stopped`, body: e.body || "Tap to retry" }),
};

const swOk = () => { try { return "serviceWorker" in navigator && window.top === window.self && location.protocol === "https:"; } catch { return false; } };
const notifOk = () => typeof window !== "undefined" && "Notification" in window;
function currentPerm(): Perm { if (isNative()) return "default"; return notifOk() ? (Notification.permission as Perm) : "unsupported"; }

async function swReg(): Promise<ServiceWorkerRegistration | null> {
  if (!swOk()) return null;
  try { return (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("./sw.js")); } catch { return null; }
}
function b64ToBytes(b64: string) { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function subscribePush() {
  const reg = await swReg(); if (!reg || !("PushManager" in window)) return;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { key } = await api<{ key: string }>("GET", "/api/push/key"); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }); }
    await api("POST", "/api/push/subscribe", { subscription: sub.toJSON() });
  } catch { /* push service unreachable — polling notifications still work */ }
}
async function systemNotify(title: string, body: string, projectId: string) {
  const n = native(); if (n) { n.notify({ title, body, projectId }).catch(() => {}); return; }
  if (!notifOk() || Notification.permission !== "granted") return;
  const url = `${location.pathname}#/p/${projectId}`;
  const reg = await swReg();
  try { if (reg) await reg.showNotification(title, { body, tag: projectId, icon: "./icon-192.png", badge: "./icon-192.png", data: { url } }); else new Notification(title, { body, tag: projectId }); } catch { /* ignore */ }
}

// Register early so the app is installable (PWA) and works offline; skipped inside iframes/previews.
if (typeof window !== "undefined") window.addEventListener("load", () => { if (!isNative()) swReg(); });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [perm, setPerm] = useState<Perm>(currentPerm());
  const last = useRef<number | null>(null);
  const tick = useRef(0);
  const wasBuilding = useRef(false);
  useEffect(() => { native()?.status().then((r: any) => setPerm(r?.notifications ? "granted" : "default")).catch(() => {}); }, []);

  const poll = useCallback(async () => {
    if (!user) return;
    try {
      const s = await api<Summary>("GET", "/api/mobile/summary");
      setSummary(s);
      const building = s.active.length > 0;
      if (building !== wasBuilding.current) queryClient.invalidateQueries({ queryKey: ["projects"] });
      const n = native();
      if (n) { n.update({ summary: JSON.stringify(s) }).catch(() => {}); if (building && !wasBuilding.current) n.startLive().catch(() => {}); }
      wasBuilding.current = building;
      const ev = await api<{ events: LiveEvent[]; last: number }>("GET", `/api/mobile/events${last.current ? `?after=${last.current}` : ""}`);
      if (last.current !== null) {
        if (ev.events.length) queryClient.invalidateQueries({ queryKey: ["projects"] });
        for (const e of ev.events) {
          const watching = !document.hidden && location.hash === `#/p/${e.projectId}`;
          if (watching) continue; // the workspace already shows this live
          const t = (EVENT_TEXT[e.type] || ((x: LiveEvent) => ({ title: x.title, body: x.body })))(e);
          toast({ title: t.title, description: t.body });
          if (document.hidden && !isNative()) systemNotify(t.title, t.body, e.projectId);
        }
      }
      last.current = ev.last || last.current || 0;
    } catch { /* offline or signed out — try again next tick */ }
  }, [user]);

  useEffect(() => {
    last.current = null; setSummary(null);
    if (!user) return;
    let alive = true, timer: any;
    const loop = async () => { await poll(); if (!alive) return; tick.current++; timer = setTimeout(loop, document.hidden ? 20000 : 3000); };
    loop();
    const vis = () => { if (!document.hidden) { clearTimeout(timer); loop(); } };
    document.addEventListener("visibilitychange", vis);
    if (currentPerm() === "granted" && !isNative()) subscribePush();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [user, poll]);

  const enable = useCallback(async (): Promise<Perm> => {
    const n = native();
    if (n) { try { const r = await n.requestPermissions(); const p: Perm = r?.notifications === "granted" ? "granted" : "denied"; setPerm(p); return p; } catch { return "denied"; } }
    if (!notifOk()) { setPerm("unsupported"); return "unsupported"; }
    const p = (await Notification.requestPermission()) as Perm;
    setPerm(p);
    if (p === "granted") { await subscribePush(); systemNotify("Notifications are on", "Stak will tell you when builds finish", ""); }
    return p;
  }, []);

  return <Ctx.Provider value={{ summary, perm, enable, refresh: poll }}>{children}</Ctx.Provider>;
}
export function useLive() { const c = useContext(Ctx); if (!c) throw new Error("useLive outside provider"); return c; }
export const apiOrigin = () => API || location.origin;
