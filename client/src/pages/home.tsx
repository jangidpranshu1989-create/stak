import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2, AppWindow, Wrench, Gamepad2, Globe, ChevronDown, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TopBar, timeAgo, KIND_LABEL } from "@/components/chrome";
import { api, type Intent, type Kind, type ProjectLite } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<Kind, typeof AppWindow> = { app: AppWindow, tool: Wrench, game: Gamepad2, site: Globe };
const KIND_HINT: Record<Kind, string> = {
  app: "Opens straight into the working product",
  tool: "Input and result on one screen",
  game: "Playable on keyboard and touch",
  site: "A page that tells a story and converts",
};

const IDEAS: { label: string; prompt: string }[] = [
  { label: "AI study buddy", prompt: "An AI chatbot that explains coding doubts step by step, with saved chat history and suggested starter questions" },
  { label: "QR code maker", prompt: "QR code generator tool — type text or a link, pick colours and size, download as PNG" },
  { label: "Expense splitter", prompt: "Trip expense splitter: add friends and expenses, see who owes whom, settle up, works in ₹" },
  { label: "Clinic booking", prompt: "Appointment booking app for a dental clinic with time slots, patient details and an admin view of bookings" },
  { label: "Snake game", prompt: "A polished snake game with swipe controls on mobile, levels, sound toggle and a global leaderboard" },
  { label: "Café website", prompt: "Website for a rooftop café in Jaipur with menu, photos, opening hours, map and table reservation form" },
  { label: "Habit tracker", prompt: "Daily habit tracker with streaks, a calendar heatmap and reminders, data saved per user" },
  { label: "Invoice generator", prompt: "GST invoice generator: business details, line items, tax calculation, preview and download as PDF" },
];

export default function Home() {
  const [, nav] = useLocation();
  const { user, ensure, ready } = useSession();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [override, setOverride] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div className="min-h-dvh bg-background">
      <TopBar />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:pt-20">
        <div className="mb-8 space-y-3">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-tight" data-testid="text-headline">
            Describe it. Stak builds the thing you meant.
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Apps open as apps, tools as tools, websites as websites. Every build ships with a database, sign-in, AI, and a test report you can read.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); start(); }}
          className="group rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10"
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
            placeholder="e.g. Ek chatbot bana jo maths doubts solve kare, history save ho…"
            className="block w-full resize-none bg-transparent px-4 pb-2 pt-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground/70"
            data-testid="input-prompt"
          />
          <div className="flex items-center gap-2 px-3 pb-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    kind ? "border-primary/30 bg-primary/10 text-foreground" : "text-muted-foreground",
                  )}
                  aria-label="Product type"
                  data-testid="button-kind"
                >
                  {kind ? (() => { const I = KIND_ICON[kind]; return <I className="h-3.5 w-3.5 text-primary" />; })() : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />}
                  <span>{kind ? KIND_LABEL[kind] : "Auto-detect type"}</span>
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
            <Button
              type="submit"
              size="icon"
              className="ml-auto h-10 w-10 rounded-full"
              disabled={busy || text.trim().length < 4 || !ready}
              aria-label="Start building"
              data-testid="button-build"
            >
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Ideas">
          {IDEAS.map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => { setText(i.prompt); setOverride(null); ta.current?.focus(); }}
              className="inline-flex h-9 items-center rounded-full border bg-background px-3.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`button-idea-${i.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {i.label}
            </button>
          ))}
        </div>

        {user && (
          <section className="mt-14" aria-labelledby="recent-h">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="recent-h" className="text-sm font-semibold">Your projects</h2>
              {list.length > 0 && <span className="text-xs text-muted-foreground">{list.length}</span>}
            </div>
            {projects.isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
            ) : list.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground" data-testid="text-empty-projects">Nothing here yet — your first build will show up here.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {list.slice(0, 12).map((p) => {
                  const I = KIND_ICON[p.kind] || AppWindow;
                  return (
                    <li key={p.id}>
                      <Link href={`/p/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none" data-testid={`link-project-${p.id}`}>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted"><I className="h-4 w-4 text-muted-foreground" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.title}</span>
                          <span className="block text-xs text-muted-foreground">{KIND_LABEL[p.kind]} · {p.version ? `v${p.version}` : "draft"}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{timeAgo(p.updated)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <footer className="mt-16 grid gap-4 border-t pt-6 text-sm sm:grid-cols-3">
          <div><div className="font-medium">Built in under a minute</div><p className="mt-1 text-muted-foreground">Groq-speed models with automatic fallback to NVIDIA NIM.</p></div>
          <div><div className="font-medium">Checked before you see it</div><p className="mt-1 text-muted-foreground">Code tests, an acceptance review and a security scan on every build.</p></div>
          <div><div className="font-medium">Yours to keep</div><p className="mt-1 text-muted-foreground">Download the full source as a ZIP. Host it anywhere.</p></div>
        </footer>
      </main>
    </div>
  );
}
