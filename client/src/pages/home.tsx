import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2, AppWindow, Wrench, Gamepad2, Globe, ChevronDown, Check, Clock, Sparkles, Bot, QrCode, Receipt, Stethoscope, Coffee, Flame, FileText, Timer, ArrowRight, Wand2, Code2, ShieldCheck, Rocket, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TopBar, timeAgo, KIND_LABEL, Logo } from "@/components/chrome";
import { api, type Intent, type Kind, type ProjectLite } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TabBar, Tile, haptic } from "@/components/nav";
import { useLive, PHASE_LABEL } from "@/lib/live";

export const KIND_ICON: Record<Kind, typeof AppWindow> = { app: AppWindow, tool: Wrench, game: Gamepad2, site: Globe };
const KIND_HINT: Record<Kind, string> = {
  app: "Opens straight into the working product",
  tool: "Input and result on one screen",
  game: "Playable on keyboard and touch",
  site: "A page that tells a story and converts",
};

const IDEAS: { label: string; prompt: string; icon: typeof AppWindow; hue: number }[] = [
  { label: "AI study buddy", icon: Bot, hue: 262, prompt: "An AI chatbot that explains coding doubts step by step, with saved chat history and suggested starter questions" },
  { label: "QR code maker", icon: QrCode, hue: 199, prompt: "QR code generator tool — type text or a link, pick colours and size, download as PNG" },
  { label: "Expense splitter", icon: Receipt, hue: 152, prompt: "Trip expense splitter: add friends and expenses, see who owes whom, settle up, works in ₹" },
  { label: "Clinic booking", icon: Stethoscope, hue: 340, prompt: "Appointment booking app for a dental clinic with time slots, patient details and an admin view of bookings" },
  { label: "Snake game", icon: Gamepad2, hue: 120, prompt: "A polished snake game with swipe controls on mobile, levels, sound toggle and a global leaderboard" },
  { label: "Café website", icon: Coffee, hue: 28, prompt: "Website for a rooftop café in Jaipur with menu, photos, opening hours, map and table reservation form" },
  { label: "Habit tracker", icon: Flame, hue: 16, prompt: "Daily habit tracker with streaks, a calendar heatmap and reminders, data saved per user" },
  { label: "Invoice generator", icon: FileText, hue: 222, prompt: "GST invoice generator: business details, line items, tax calculation, preview and download as PDF" },
];

const SHOWCASE = [
  { img: "showcase/chat.webp", title: "AskMe AI", tag: "AI chatbot", prompt: "An AI chatbot with saved chat history, suggested starter questions and markdown answers" },
  { img: "showcase/expense.webp", title: "Expense Tracker", tag: "Tracker", prompt: "Expense tracker in ₹ with monthly budget, category donut chart, 6-month trend and recent transactions" },
  { img: "showcase/cafe.webp", title: "Café website", tag: "Website", prompt: "Website for a cosy café in Connaught Place with menu, photos, opening hours and table reservation" },
  { img: "showcase/snake.webp", title: "Snake Quest", tag: "Game", prompt: "Snake game with levels, high score and mobile swipe controls" },
  { img: "showcase/timer.webp", title: "FocusPulse", tag: "Tool", prompt: "Build a customizable work-and-break interval timer with audio alerts and a daily focus streak counter" },
  { img: "showcase/converter.webp", title: "UnitSwap", tag: "Utility", prompt: "Unit converter for length, weight, temperature and currency with recent conversions" },
];
const TYPEWRITER = ["An AI tutor that explains maths step by step…", "Ek expense tracker bana do, monthly budget ke saath…", "A booking app for my salon with time slots…", "Pomodoro timer with streaks and sounds…", "Portfolio website for a wedding photographer…"];
const STEPS = [
  { icon: Wand2, title: "Plan", body: "Your words become a blueprint: screens, data and a checklist." },
  { icon: Code2, title: "Build", body: "Real code with a database, login and AI wired in." },
  { icon: ShieldCheck, title: "Test", body: "Code, layout, security and acceptance checks — fixed automatically." },
  { icon: Rocket, title: "Ship", body: "A live link instantly, plus the full source as a ZIP." },
];

function useTypewriter(on: boolean) {
  const [t, setT] = useState("");
  useEffect(() => {
    if (!on) return;
    let i = 0, j = 0, del = false, timer: any;
    const step = () => {
      const w = TYPEWRITER[i % TYPEWRITER.length];
      j += del ? -1 : 1; setT(w.slice(0, j));
      if (!del && j >= w.length) { del = true; timer = setTimeout(step, 1600); return; }
      if (del && j <= 0) { del = false; i++; }
      timer = setTimeout(step, del ? 18 : 38);
    };
    timer = setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [on]);
  return t;
}

export default function Home() {
  const [, nav] = useLocation();
  const { user, ensure, ready } = useSession();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [override, setOverride] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const { summary } = useLive();
  const typed = useTypewriter(!text);

  // tab bar "Create", Android widgets and deep links ask the composer to open (optionally with a prompt)
  useEffect(() => {
    const take = (p?: string) => {
      if (p) setText(p);
      requestAnimationFrame(() => { window.scrollTo({ top: 0, behavior: "smooth" }); ta.current?.focus(); });
    };
    try { const p = sessionStorage.getItem("stak_prefill"); const f = sessionStorage.getItem("stak_focus"); sessionStorage.removeItem("stak_prefill"); sessionStorage.removeItem("stak_focus"); if (p || f) take(p || undefined); } catch {}
    const on = (e: Event) => { try { sessionStorage.removeItem("stak_prefill"); sessionStorage.removeItem("stak_focus"); } catch {} take((e as CustomEvent).detail || undefined); };
    window.addEventListener("stak:create", on);
    return () => window.removeEventListener("stak:create", on);
  }, []);

  const projects = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: () => api<ProjectLite[]>("GET", "/api/projects"),
    enabled: !!user,
  });

  // live intent detection (local rules on the server, no model call)
  useEffect(() => {
    const t = text.trim();
    if (t.length < 6) { setIntent(null); return; }
    const h = setTimeout(() => { api<Intent>("POST", "/api/intent", { prompt: t }).then(setIntent).catch(() => {}); }, 260);
    return () => clearTimeout(h);
  }, [text]);

  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [text]);

  const kind: Kind | null = override || (intent && intent.confidence >= 0.4 ? intent.kind : null);

  const start = async () => {
    const prompt = text.trim();
    if (prompt.length < 4 || busy) return;
    setBusy(true);
    try {
      await ensure();
      const r = await api<{ project: ProjectLite; jobId: string }>("POST", "/api/projects", { prompt, kind: override || undefined });
      nav(`/p/${r.project.id}`);
    } catch (e: any) {
      toast({ title: "Couldn't start", description: e.message, variant: "destructive" });
      setBusy(false);
    }
  };

  const list = projects.data || [];
  const activeBy = new Map((summary?.active || []).map((a) => [a.projectId, a]));
  const pendingBy = new Set((summary?.pending || []).map((a) => a.projectId));
  const pick = (prompt: string) => { haptic(); setText(prompt); setOverride(null); window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => ta.current?.focus(), 250); };

  return (
    <div className="min-h-dvh bg-background pb-tabbar">
      <TopBar />
      <div className="relative">
        <div className="aurora" aria-hidden="true" />
        <div className="dots pointer-events-none absolute inset-0 -z-0" aria-hidden="true" />
        <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-10 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center fade-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary" data-testid="badge-new">
              <Sparkles className="h-3.5 w-3.5" />Universal engine · builds anything you describe
            </span>
            <h1 className="mt-5 font-display text-[40px] font-bold leading-[1.02] tracking-tight sm:text-6xl" data-testid="text-headline">
              Idea se <span className="text-gradient">real app</span>,<br className="hidden sm:block" /> minutes mein.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg">
              Describe it in English or Hinglish. Stak plans, codes, tests and ships it — with a database, login and AI built in.
            </p>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); start(); }}
            className="ring-brand mx-auto mt-8 max-w-3xl rounded-[26px] bg-card/85 shadow-[0_30px_80px_-30px_hsl(0_0%_0%/.6)] backdrop-blur-xl fade-up"
            style={{ animationDelay: "80ms" }}
            data-testid="form-composer"
          >
            <label htmlFor="composer" className="sr-only">What do you want to build?</label>
            <textarea
              id="composer"
              ref={ta}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }}
              rows={3}
              maxLength={6000}
              placeholder={typed || "Describe the app you want…"}
              className="block w-full resize-none bg-transparent px-5 pb-2 pt-5 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/60 sm:text-[17px]"
              data-testid="input-prompt"
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "press inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      kind ? "border-primary/30 bg-primary/10 text-foreground" : "bg-background/40 text-muted-foreground",
                    )}
                    aria-label="Product type"
                    data-testid="button-kind"
                  >
                    {kind ? (() => { const I = KIND_ICON[kind]; return <I className="h-3.5 w-3.5 text-primary" />; })() : <Sparkles className="h-3.5 w-3.5" />}
                    <span>{kind ? KIND_LABEL[kind] : "Auto-detect"}</span>
                    {kind && !override && intent && <span className="text-muted-foreground">· auto</span>}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">What should Stak build?</DropdownMenuLabel>
                  {(["app", "tool", "game", "site"] as Kind[]).map((k) => {
                    const I = KIND_ICON[k];
                    return (
                      <DropdownMenuItem key={k} onClick={() => setOverride(k)} className="items-start gap-3 py-2" data-testid={`menu-kind-${k}`}>
                        <I className="mt-0.5 h-4 w-4 text-primary" />
                        <div className="flex-1"><div className="text-sm font-medium">{KIND_LABEL[k]}</div><div className="text-xs text-muted-foreground">{KIND_HINT[k]}</div></div>
                        {kind === k && <Check className="mt-0.5 h-4 w-4" />}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setOverride(null)} data-testid="menu-kind-auto">Auto-detect from my words</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="hidden text-xs text-muted-foreground sm:inline">Enter to build · Shift+Enter for a new line</span>
              <button
                type="submit"
                className={cn("press ml-auto inline-flex h-10 items-center gap-1.5 rounded-full pl-4 pr-3 text-sm font-semibold text-white transition-opacity", "bg-brand glow-brand", (busy || text.trim().length < 4 || !ready) && "opacity-50 shadow-none")}
                disabled={busy || text.trim().length < 4 || !ready}
                aria-label="Start building"
                data-testid="button-build"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Build<ArrowUp className="h-4 w-4" /></>}
              </button>
            </div>
          </form>

          <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 sm:mx-auto sm:max-w-3xl sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 fade-up" style={{ animationDelay: "140ms" }} aria-label="Ideas">
            {IDEAS.map((i) => (
              <button
                key={i.label}
                type="button"
                onClick={() => pick(i.prompt)}
                className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full border bg-card/70 pl-1.5 pr-3.5 text-sm text-foreground/85 backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`button-idea-${i.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `hsl(${i.hue} 85% 55% / .16)`, color: `hsl(${i.hue} 85% 60%)` }}><i.icon className="h-3.5 w-3.5" /></span>
                {i.label}
              </button>
            ))}
          </div>

          {user && list.length > 0 && (
            <section className="mt-14" aria-labelledby="recent-h">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="recent-h" className="font-display text-lg font-bold tracking-tight">Continue building</h2>
                <Link href="/projects" className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-all-projects">All {list.length}<ChevronRight className="h-4 w-4" /></Link>
              </div>
              <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
                {list.slice(0, 6).map((p) => {
                  const I = KIND_ICON[p.kind] || AppWindow;
                  const a = activeBy.get(p.id);
                  return (
                    <Link key={p.id} href={`/p/${p.id}`} className="card-lift press group relative w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border bg-card p-4 sm:w-auto" data-testid={`link-project-${p.id}`}>
                      <div className="flex items-start justify-between">
                        <Tile id={p.id} icon={I} className="h-11 w-11" />
                        {a ? <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary"><span className="live-dot h-1.5 w-1.5 rounded-full bg-primary text-primary" />{Math.round(a.progress * 100)}%</span>
                          : pendingBy.has(p.id) ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">Needs answers</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{p.version ? `v${p.version}` : "draft"}</span>}
                      </div>
                      <div className="mt-4 truncate font-semibold">{p.title}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        {a ? <span className="truncate">{PHASE_LABEL[a.phase] || "Building"}…</span> : <><span>{KIND_LABEL[p.kind]}</span><span>·</span><Clock className="h-3 w-3" />{timeAgo(p.updated)}</>}
                      </div>
                      {a && <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/10"><span className="block h-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(5, a.progress * 100)}%` }} /></span>}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-16" aria-labelledby="show-h">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 id="show-h" className="font-display text-lg font-bold tracking-tight sm:text-2xl">Made with Stak</h2>
                <p className="mt-1 text-sm text-muted-foreground">Real builds from one sentence. Tap one to start from its prompt.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              {SHOWCASE.map((c, k) => (
                <button key={c.title} type="button" onClick={() => pick(c.prompt)} className="card-lift press group overflow-hidden rounded-2xl border bg-card text-left fade-up" style={{ animationDelay: `${k * 50}ms` }} data-testid={`card-showcase-${k}`}>
                  <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                    <img src={c.img} alt={`${c.title} built with Stak`} loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]" />
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur">{c.tag}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <span className="truncate text-sm font-semibold">{c.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-16" aria-labelledby="how-h">
            <h2 id="how-h" className="font-display text-lg font-bold tracking-tight sm:text-2xl">From sentence to shipped</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STEPS.map((st, k) => (
                <div key={st.title} className="relative overflow-hidden rounded-2xl border bg-card p-4">
                  <span className="absolute right-3 top-2 font-display text-4xl font-bold text-foreground/[.06]">{k + 1}</span>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><st.icon className="h-5 w-5" /></span>
                  <div className="mt-3 font-semibold">{st.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{st.body}</p>
                </div>
              ))}
            </div>
          </section>

          <footer className="mt-16 flex flex-col items-center gap-2 border-t py-8 text-center text-xs text-muted-foreground">
            <Logo />
            <p>Groq-speed models with NVIDIA NIM fallback · every build tested before you see it</p>
          </footer>
        </main>
      </div>
      <TabBar />
    </div>
  );
}
