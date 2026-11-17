import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2, X, MousePointerClick, AlertTriangle, Eye, Code2, Database, History, Settings2, MessageSquare, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar, KIND_LABEL } from "@/components/chrome";
import { MessageView, QuestionStepper, LiveBuild, Md } from "@/components/thread";
import { Preview, CodeView, CloudView, HistoryView, SettingsView, type Selection } from "@/components/panels";
import { api, zipUrl, type JobView, type Message, type Project, type Version } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { KIND_ICON } from "@/pages/home";
import { cn } from "@/lib/utils";

type Tab = "preview" | "code" | "cloud" | "history" | "settings";
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "preview", label: "Preview", icon: Eye }, { id: "code", label: "Code", icon: Code2 }, { id: "cloud", label: "Cloud", icon: Database },
  { id: "history", label: "History", icon: History }, { id: "settings", label: "Settings", icon: Settings2 },
];

interface Detail { project: Project; messages: Message[]; versions: Version[]; activeJob: string | null }

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { user, ready } = useSession();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("preview");
  const [mobileView, setMobileView] = useState<"chat" | "app">("chat");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [live, setLive] = useState("");
  const [text, setText] = useState("");
  const [sel, setSel] = useState<Selection | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const q = useQuery({ queryKey: ["project", id], queryFn: () => api<Detail>("GET", `/api/projects/${id}`), enabled: ready && !!user, retry: false });
  const d = q.data;
  const p = d?.project;

  useEffect(() => { if (d?.activeJob && !jobId) setJobId(d.activeJob); }, [d?.activeJob, jobId]);
  useEffect(() => { if (ready && !user) nav("/"); }, [ready, user, nav]);

  // poll the running job
  useEffect(() => {
    if (!jobId) return;
    let stop = false, from = 0, t: any;
    setLive("");
    const tick = async () => {
      try {
        const j = await api<JobView>("GET", `/api/jobs/${jobId}?from=${from}`);
        if (stop) return;
        if (j.delta) { from += j.delta.length; setLive((s) => s + j.delta); }
        setJob(j);
        if (j.status === "running" || j.status === "queued") { t = setTimeout(tick, 900); return; }
        setJobId(null); setJob(null); setLive(""); setStopping(false);
        await q.refetch();
        if (j.status === "done" && j.type !== "questions") { setErrs([]); setMobileView("app"); }
      } catch { if (!stop) t = setTimeout(tick, 2500); }
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [d?.messages.length, job?.steps?.length, job?.status]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }, [text]);

  const busy = !!jobId;
  const pendingQ = useMemo(() => {
    const m = [...(d?.messages || [])].reverse().find((x) => x.kind === "questions");
    return m && m.meta?.status === "ready" && !m.meta?.answered ? m : null;
  }, [d?.messages]);

  const submitAnswers = async (v: { answers: Record<string, string[]>; secrets: Record<string, string>; notes: string; skip?: boolean }) => {
    setSending(true);
    try { const r = await api<{ jobId: string }>("POST", `/api/projects/${id}/answers`, v); await q.refetch(); setJobId(r.jobId); }
    catch (e: any) { toast({ title: "Couldn't start the build", description: e.message, variant: "destructive" }); }
    finally { setSending(false); }
  };

  const send = async (msg?: string) => {
    const t = (msg ?? text).trim();
    if (!t || busy || sending) return;
    setSending(true);
    try {
      const r = await api<{ jobId: string }>("POST", `/api/projects/${id}/messages`, { text: t, selection: sel || undefined, via: sel ? "select" : "text" });
      setText(""); setSel(null);
      await q.refetch(); setJobId(r.jobId); setMobileView("chat");
    } catch (e: any) { toast({ title: "Couldn't send", description: e.message, variant: "destructive" }); }
    finally { setSending(false); }
  };

  const retry = async () => {
    setSending(true);
    try { const r = await api<{ jobId: string }>("POST", `/api/projects/${id}/retry`); await q.refetch(); setJobId(r.jobId); }
    catch (e: any) { toast({ title: "Couldn't retry", description: e.message, variant: "destructive" }); }
    finally { setSending(false); }
  };
  const stop = async () => { setStopping(true); await api("POST", `/api/projects/${id}/stop`).catch(() => {}); };

  const upload = async (f: File): Promise<string | null> => {
    if (f.size > 6e6) { toast({ title: `${f.name} is over 6 MB`, variant: "destructive" }); return null; }
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
    try { return (await api<{ path: string }>("POST", `/api/projects/${id}/uploads`, { name: f.name, data })).path; }
    catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); return null; }
  };

  const onSelect = useCallback((s: Selection) => { setSel(s); setMobileView("chat"); setTimeout(() => ta.current?.focus(), 50); }, []);
  const onError = useCallback((e: string) => !/^Script error\.?/i.test(e) && setErrs((x) => (x.includes(e) ? x : [...x, e].slice(-5))), []);

  if (q.error) {
    return (
      <div className="min-h-dvh"><TopBar /><div className="mx-auto max-w-md px-4 py-24 text-center"><AlertTriangle className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><h1 className="text-base font-semibold">Project not found</h1><p className="mt-1 text-sm text-muted-foreground">It may belong to another account, or it was deleted.</p><Button className="mt-4 h-10" onClick={() => nav("/")}>Back home</Button></div></div>
    );
  }
  if (!p) return <div className="min-h-dvh"><TopBar /><div className="grid h-[60vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></div>;

  const KI = KIND_ICON[p.kind];
  const hasSite = p.version > 0;
  const thread = d!.messages.filter((m) => !(m.kind === "build" || m.kind === "edit") || m.meta?.status !== "running");

  const chat = (
    <section className="flex h-full min-h-0 flex-col" aria-label="Conversation">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
        {thread.map((m) => <MessageView key={m.id} m={m} onRetry={retry} retrying={sending} />)}
        {pendingQ && !busy && (
          <QuestionStepper key={pendingQ.id} questions={pendingQ.meta.questions || []} intro={pendingQ.content} busy={sending} onSubmit={submitAnswers} onUpload={upload} />
        )}
        {busy && job && job.type !== "questions" && <LiveBuild job={job} onStop={stop} stopping={stopping} />}
        {busy && (!job || job.type === "questions") && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-thinking"><Loader2 className="h-4 w-4 animate-spin" />{job?.type === "questions" ? "Understanding what you need…" : "Starting…"}</div>
        )}
        <div ref={endRef} />
      </div>
      {errs.length > 0 && hasSite && !busy && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm" data-testid="banner-preview-errors">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1"><div className="font-medium">{errs.length} error{errs.length > 1 ? "s" : ""} in the preview</div><div className="truncate font-mono text-xs text-muted-foreground">{errs[errs.length - 1]}</div></div>
          <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => { send(`Fix these runtime errors from the preview:\n${errs.map((e) => "- " + e).join("\n")}`); setErrs([]); }} data-testid="button-fix-errors">Fix</Button>
          <button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => setErrs([])} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}
      <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); send(); }} data-testid="form-chat">
        {sel && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs" data-testid="chip-selection">
            <MousePointerClick className="h-3.5 w-3.5 text-primary" /><span className="min-w-0 flex-1 truncate">Editing <span className="font-medium">{sel.label}</span> <span className="font-mono text-muted-foreground">{sel.selector}</span></span>
            <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-background/60" onClick={() => setSel(null)} aria-label="Clear selection"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
          <label htmlFor="chat-input" className="sr-only">Message Stak</label>
          <textarea id="chat-input" ref={ta} rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={busy ? "Stak is working…" : sel ? "What should change here?" : hasSite ? "Ask for a change…" : pendingQ ? "Or describe it in your own words…" : "Describe what to build…"}
            className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70" disabled={busy} data-testid="input-chat" />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0 rounded-lg" disabled={busy || sending || !text.trim()} aria-label="Send" data-testid="button-send">{sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}</Button>
        </div>
      </form>
    </section>
  );

  const tabs = (
    <div className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2" role="tablist" aria-label="Workspace panels">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`tab-${t.id}`}>
          <t.icon className="h-4 w-4" />{t.label}
          {tab === t.id && <span className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-primary" />}
        </button>
      ))}
    </div>
  );

  const panel = (
    <section className="flex h-full min-h-0 flex-col" aria-label="Your app">
      {tabs}
      <div className="min-h-0 flex-1">
        {tab === "preview" && (hasSite ? <Preview project={p} onSelect={onSelect} onError={onError} building={busy} /> : <BuildingPlaceholder busy={busy} job={job} />)}
        {tab === "code" && <CodeView files={p.files} live={busy && live ? live : undefined} />}
        {tab === "cloud" && <CloudView project={p} />}
        {tab === "history" && <HistoryView project={p} versions={d!.versions} busy={busy} onRestored={() => q.refetch()} />}
        {tab === "settings" && <SettingsView project={p} />}
      </div>
    </section>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TopBar
        right={hasSite ? <Button variant="ghost" size="sm" className="hidden h-9 sm:inline-flex" asChild><a href={zipUrl(p.id)} data-testid="link-zip-top"><Download />ZIP</a></Button> : null}
      >
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <span className="flex min-w-0 items-center gap-2">
          <KI className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-medium" data-testid="text-project-title">{p.title}</span>
          <span className="hidden shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">{KIND_LABEL[p.kind]}{p.version ? ` · v${p.version}` : ""}</span>
        </span>
      </TopBar>

      {/* mobile switcher */}
      <div className="flex shrink-0 border-b p-1.5 md:hidden" role="tablist" aria-label="View">
        {([["chat", "Chat", MessageSquare], ["app", "App", Eye]] as const).map(([v, l, I]) => (
          <button key={v} role="tab" aria-selected={mobileView === v} onClick={() => setMobileView(v)} className={cn("inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm", mobileView === v ? "bg-muted font-medium" : "text-muted-foreground")} data-testid={`button-mobile-${v}`}><I className="h-4 w-4" />{l}</button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 w-full border-r md:block md:w-[400px] md:shrink-0 lg:w-[440px]", mobileView === "chat" ? "block" : "hidden")}>{chat}</div>
        <div className={cn("min-h-0 min-w-0 flex-1 md:block", mobileView === "app" ? "block" : "hidden")}>{panel}</div>
      </div>
    </div>
  );
}

function BuildingPlaceholder({ busy, job }: { busy: boolean; job: JobView | null }) {
  const bp = job?.blueprint;
  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <div className="w-full max-w-md">
        {bp ? (
          <div className="rounded-2xl border bg-card p-4" data-testid="card-blueprint">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Blueprint</div>
            <div className="text-base font-semibold">{bp.name}</div>
            {bp.oneLiner && <Md text={bp.oneLiner} className="mt-1 text-muted-foreground" />}
            {bp.features && bp.features.length > 0 && <ul className="mt-3 space-y-1.5 text-sm">{bp.features.slice(0, 8).map((f, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />{f}</li>)}</ul>}
            {bp.acceptance && bp.acceptance.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{bp.acceptance.length} acceptance checks will be verified before you see it.</p>}
          </div>
        ) : (
          <div className="text-center">
            {busy ? <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-muted-foreground" /> : <Eye className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />}
            <div className="text-sm font-medium">{busy ? "Your app is on its way" : "Answer a few questions to start"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{busy ? "The preview opens here when the first version is ready." : "Or skip them and Stak will choose smart defaults."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
