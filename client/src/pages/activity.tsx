import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Pencil, MessageCircleQuestion, AlertTriangle, Bell, Hammer, Zap, Layers, Rocket } from "lucide-react";
import { TopBar, timeAgo } from "@/components/chrome";
import { TabBar, PageTitle, requestCreate } from "@/components/nav";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLive, PHASE_LABEL, EVENT_TEXT, type LiveEvent } from "@/lib/live";
import { cn } from "@/lib/utils";

const EV_ICON: Record<string, { icon: any; cls: string }> = {
  build_done: { icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-500" },
  edit_done: { icon: Pencil, cls: "bg-sky-500/15 text-sky-500" },
  questions_ready: { icon: MessageCircleQuestion, cls: "bg-amber-500/15 text-amber-500" },
  job_failed: { icon: AlertTriangle, cls: "bg-red-500/15 text-red-500" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function ActivityPage() {
  const { user } = useSession();
  const { summary, perm, enable } = useLive();
  const [, nav] = useLocation();
  const events = useQuery({ queryKey: ["events", user?.id, summary?.stats.ready, summary?.stats.building], queryFn: () => api<{ events: LiveEvent[] }>("GET", "/api/mobile/events"), enabled: !!user });
  const s = summary?.stats;
  const u = summary?.usage;
  const list = [...(events.data?.events || [])].reverse();

  return (
    <div className="min-h-dvh bg-background pb-tabbar">
      <TopBar />
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
        <PageTitle title="Activity" sub="Live builds and everything Stak did for you" />

        <div className="grid grid-cols-3 gap-2.5">
          {[{ k: "Building", v: s?.building ?? 0, icon: Hammer, hue: 18 }, { k: "Live apps", v: s?.ready ?? 0, icon: Rocket, hue: 152 }, { k: "Projects", v: s?.projects ?? 0, icon: Layers, hue: 262 }].map((x) => (
            <div key={x.k} className="rounded-2xl border bg-card p-3.5" data-testid={`stat-${x.k.toLowerCase().replace(" ", "-")}`}>
              <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `hsl(${x.hue} 85% 55% / .15)`, color: `hsl(${x.hue} 85% 58%)` }}><x.icon className="h-4 w-4" /></span>
              <div className="mt-2.5 font-display text-2xl font-bold tabular-nums">{x.v}</div>
              <div className="text-xs text-muted-foreground">{x.k}</div>
            </div>
          ))}
        </div>

        {u && (
          <div className="mt-2.5 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between text-sm"><span className="inline-flex items-center gap-1.5 font-medium"><Zap className="h-4 w-4 text-primary" />AI calls today</span><span className="tabular-nums text-muted-foreground">{u.aiUsed} / {u.aiLimit}</span></div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.min(100, (u.aiUsed / Math.max(1, u.aiLimit)) * 100)}%` }} /></div>
          </div>
        )}

        {!!summary?.active.length && (
          <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Building now</h2>
            <div className="space-y-2.5">
              {summary.active.map((j) => (
                <Link key={j.jobId} href={`/p/${j.projectId}`} className="press ring-brand relative block overflow-hidden rounded-2xl bg-card p-4" data-testid={`active-${j.projectId}`}>
                  <div className="flex items-center gap-3">
                    <span className="live-dot h-2.5 w-2.5 rounded-full bg-primary text-primary" />
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{j.title}</div><div className="text-xs text-muted-foreground">{PHASE_LABEL[j.phase] || "Building"}{j.model ? ` · ${j.model}` : ""}</div></div>
                    <div className="text-right"><div className="font-display text-lg font-bold tabular-nums text-primary">{Math.round(j.progress * 100)}%</div><div className="font-mono text-[11px] text-muted-foreground">{clock(j.elapsed)}</div></div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(4, j.progress * 100)}%` }} /></div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {perm !== "granted" && perm !== "unsupported" && user && (
          <button onClick={() => enable()} className="press mt-8 flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-left" data-testid="button-enable-notify">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white"><Bell className="h-5 w-5" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold">Turn on notifications</span><span className="block text-xs text-muted-foreground">Get pinged when a build finishes or needs answers — even with Stak closed.</span></span>
          </button>
        )}

        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</h2>
          {!list.length ? (
            <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
              Nothing yet. <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => requestCreate(nav)}>Start a build</button> and updates will appear here in real time.
            </div>
          ) : (
            <ol className="relative space-y-1 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-border">
              {list.map((e) => {
                const m = EV_ICON[e.type] || { icon: Bell, cls: "bg-muted text-muted-foreground" };
                const t = (EVENT_TEXT[e.type] || ((x: LiveEvent) => ({ title: x.title, body: x.body })))(e);
                return (
                  <li key={e.id}>
                    <Link href={`/p/${e.projectId}`} className="press relative flex items-start gap-3 rounded-xl p-1.5 pr-2 hover:bg-card" data-testid={`event-${e.id}`}>
                      <span className={cn("relative z-10 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full ring-[6px] ring-background ml-[6px] mt-0.5", m.cls)}><m.icon className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.title}</span><span className="block truncate text-xs text-muted-foreground">{t.body}</span></span>
                      <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{timeAgo(e.created)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
      <TabBar />
    </div>
  );
}
