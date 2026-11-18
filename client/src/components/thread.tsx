import { useMemo, useState } from "react";
import { Check, X, Loader2, CircleDashed, AlertTriangle, ShieldCheck, ChevronDown, RotateCcw, Square, FileCode2, Sparkles, ImageIcon, ExternalLink, KeyRound, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { JobView, Message, Question, Report, Step, Usage } from "@/lib/api";
import { cn } from "@/lib/utils";

// minimal, safe markdown: **bold**, `code`, line breaks
export function Md({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    String(text || "").split(/\n/).forEach((line, li) => {
      if (li) out.push(<br key={`br${li}`} />);
      line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((seg, i) => {
        if (/^\*\*[^*]+\*\*$/.test(seg)) out.push(<strong key={`${li}-${i}`} className="font-semibold">{seg.slice(2, -2)}</strong>);
        else if (/^`[^`]+`$/.test(seg)) out.push(<code key={`${li}-${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{seg.slice(1, -1)}</code>);
        else if (seg) out.push(seg);
      });
    });
    return out;
  }, [text]);
  return <p className={cn("text-sm leading-relaxed", className)}>{parts}</p>;
}

const fmtMs = (ms?: number) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function StepList({ steps, live }: { steps: Step[]; live?: boolean }) {
  if (!steps?.length) return live ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Getting ready…</div> : null;
  return (
    <ol className="relative space-y-0.5" data-testid="list-steps">
      {steps.map((s) => (
        <li key={s.id} className="flex min-h-8 items-center gap-2.5 text-sm">
          <span className="grid h-5 w-5 shrink-0 place-items-center">
            {s.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : s.status === "done" ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : s.status === "error" ? <X className="h-4 w-4 text-destructive" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", s.status === "running" ? "text-foreground" : "text-muted-foreground")}>
            {s.label}{s.detail ? <span className="text-muted-foreground"> · {s.detail}</span> : null}
          </span>
          {s.ms != null && s.status !== "running" && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{fmtMs(s.ms)}</span>}
        </li>
      ))}
    </ol>
  );
}

function UsageLine({ usage, models, duration }: { usage?: Usage; models?: string[]; duration?: number }) {
  if (!usage && !models?.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="text-usage">
      {duration != null && <span>{fmtMs(duration)}</span>}
      {usage && <span className="font-mono tabular-nums">{fmtTok(usage.prompt)} in · {fmtTok(usage.completion)} out · {usage.calls} calls</span>}
      {models?.length ? <span>{models.join(", ")}</span> : null}
    </div>
  );
}

export function ReportCard({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const rv = report.review, sec = report.security, qa = report.qa;
  const grade = sec?.label || "–";
  const gradeTone = grade === "A" ? "text-emerald-600 dark:text-emerald-400" : grade === "B" ? "text-amber-600 dark:text-amber-400" : "text-destructive";
  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-background" data-testid="card-report">
      <button type="button" onClick={() => setOpen(!open)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-expanded={open} data-testid="button-report-toggle">
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {rv && <span><span className="font-semibold tabular-nums">{rv.passed}/{rv.total}</span> <span className="text-muted-foreground">checks</span></span>}
          {sec && <span className="inline-flex items-center gap-1"><ShieldCheck className={cn("h-4 w-4", gradeTone)} /><span className={cn("font-semibold", gradeTone)}>{grade}</span> <span className="text-muted-foreground">security</span></span>}
          {qa && <span><span className="font-semibold tabular-nums">{qa.repaired + qa.autoFixed}</span> <span className="text-muted-foreground">auto-fixed</span></span>}
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t px-3 py-3">
          {rv && rv.checks.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acceptance checks</h4>
              <ul className="space-y-1.5">
                {rv.checks.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    {c.pass ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                    <span><span>{c.check}</span>{!c.pass && c.why && <span className="block text-xs text-muted-foreground">{c.why}</span>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sec && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Security scan · {sec.score}/100</h4>
              {sec.issues.length === 0 ? <p className="text-sm text-muted-foreground">No exposed keys, unsafe HTML or open admin screens found.</p> : (
                <ul className="space-y-1.5">{sec.issues.map((x, i) => <li key={i} className="text-sm"><span className="font-mono text-xs text-muted-foreground">{x.file}</span> {x.problem}{x.fix && <span className="block text-xs text-muted-foreground">Fix: {x.fix}</span>}</li>)}</ul>
              )}
            </section>
          )}
          {qa && qa.remaining.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Known issues</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{qa.remaining.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </section>
          )}
          {report.photos && report.photos.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos · Wikimedia Commons</h4>
              <ul className="space-y-1">{report.photos.map((p, i) => <li key={i} className="text-xs text-muted-foreground"><a className="underline-offset-2 hover:text-foreground hover:underline" href={p.page} target="_blank" rel="noreferrer">{p.title.replace(/\.(jpe?g|png|webp)$/i, "")}</a> · {p.author} · {p.license}</li>)}</ul>
            </section>
          )}
          {report.sources && report.sources.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Research sources</h4>
              <ul className="space-y-1">{report.sources.map((s, i) => <li key={i} className="truncate text-xs"><a className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>)}</ul>
            </section>
          )}
          {report.steps && <section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h4><StepList steps={report.steps} /></section>}
          <UsageLine usage={report.usage} models={report.models} duration={report.duration} />
          {report.notes && report.notes.length > 0 && <p className="text-xs text-muted-foreground">{report.notes.join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}

export function LiveBuild({ job, onStop, stopping }: { job: JobView; onStop: () => void; stopping: boolean }) {
  const files = job.doneFiles || [];
  return (
    <div className="rounded-2xl border bg-card p-3" data-testid="card-live-build">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary" /></span>
        <span className="text-sm font-medium">{job.phase === "queued" ? "Waiting for a free slot" : job.type === "edit" ? "Applying your change" : "Building"}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{job.elapsed ?? 0}s</span>
        <Button variant="ghost" size="sm" className="ml-auto h-9" onClick={onStop} disabled={stopping} data-testid="button-stop"><Square className="h-3.5 w-3.5 fill-current" />Stop</Button>
      </div>
      {job.blueprint?.oneLiner && <p className="mb-2 text-sm text-muted-foreground">{job.blueprint.oneLiner}</p>}
      <StepList steps={job.steps || []} live />
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f) => <span key={f} className="inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-muted-foreground"><FileCode2 className="h-3 w-3" />{f}</span>)}
        </div>
      )}
      <div className="mt-2"><UsageLine usage={job.usage} models={job.model ? [job.model] : undefined} /></div>
    </div>
  );
}

// ---- questions: one at a time, quick to answer, skippable
export function QuestionStepper({ questions, intro, onSubmit, busy, onUpload }: {
  questions: Question[]; intro?: string; busy: boolean;
  onSubmit: (v: { answers: Record<string, string[]>; secrets: Record<string, string>; notes: string; skip?: boolean }) => void;
  onUpload: (f: File) => Promise<string | null>;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const total = questions.length;
  const q = questions[i];
  const last = i >= total - 1;
  const set = (id: string, v: string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (qq: Question, opt: string) => {
    const cur = answers[qq.id] || [];
    if (qq.type === "multi") set(qq.id, cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
    else { set(qq.id, [opt]); if (!last) setTimeout(() => setI((x) => Math.min(x + 1, total - 1)), 140); }
  };
  const submit = (skip = false) => onSubmit({ answers, secrets, notes, skip });

  if (!q) return null;
  const ups = (answers[q.id] || []).filter((v) => v.startsWith("upload:assets/"));

  return (
    <div className="rounded-2xl border bg-card" data-testid="card-questions">
      {intro && <div className="border-b px-4 py-3"><Md text={intro} /></div>}
      <div className="px-4 pb-4 pt-3">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden="true">{questions.map((_, k) => <span key={k} className={cn("h-1 flex-1 rounded-full", k <= i ? "bg-primary" : "bg-muted")} />)}</div>
          <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">{i + 1}/{total}</span>
        </div>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">{q.question}</legend>
          {(q.type === "single" || q.type === "multi") && (
            <div className="flex flex-wrap gap-2" role={q.type === "single" ? "radiogroup" : "group"}>
              {q.options?.map((o) => {
                const on = (answers[q.id] || []).includes(o);
                return (
                  <button key={o} type="button" role={q.type === "single" ? "radio" : "checkbox"} aria-checked={on} onClick={() => toggle(q, o)}
                    className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary bg-primary/10 text-foreground" : "hover:border-foreground/25")}
                    data-testid={`option-${q.id}-${o.slice(0, 20).replace(/\W+/g, "-").toLowerCase()}`}>
                    {on && <Check className="h-3.5 w-3.5 text-primary" />}{o}
                  </button>
                );
              })}
            </div>
          )}
          {q.type === "text" && <Input className="h-11" placeholder={q.placeholder || "Type your answer"} value={(answers[q.id] || [""])[0]} onChange={(e) => set(q.id, e.target.value ? [e.target.value] : [])} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); last ? submit() : setI(i + 1); } }} data-testid={`input-${q.id}`} />}
          {q.type === "secret" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><KeyRound className="h-3.5 w-3.5" />Stored encrypted on the server as <code className="font-mono">{q.secretName}</code>. Never sent to the browser.</div>
              <Input className="h-11 font-mono" type="password" autoComplete="off" placeholder={q.placeholder || "Paste key (optional)"} value={secrets[q.secretName!] || ""} onChange={(e) => setSecrets((s) => ({ ...s, [q.secretName!]: e.target.value }))} data-testid={`input-secret-${q.secretName}`} />
              {q.helpUrl && <a href={q.helpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">Where do I get this? <ExternalLink className="h-3 w-3" /></a>}
            </div>
          )}
          {q.type === "images" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(q.options || []).map((o, k) => {
                  const on = (answers[q.id] || [])[0] === o;
                  return <button key={o} type="button" onClick={() => set(q.id, [o, ...(k === 0 ? ups : [])])} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm", on ? "border-primary bg-primary/10" : "hover:border-foreground/25")} data-testid={`option-images-${k}`}>{on && <Check className="h-3.5 w-3.5 text-primary" />}{o}</button>;
                })}
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                {ups.length ? `${ups.length} photo${ups.length > 1 ? "s" : ""} added — add more` : "Upload your photos"}
                <input type="file" accept="image/*" multiple className="sr-only" data-testid="input-upload" onChange={async (e) => {
                  const fl = Array.from(e.target.files || []).slice(0, q.max || 12); if (!fl.length) return;
                  setUploading(true);
                  const paths: string[] = [];
                  for (const f of fl) { const p = await onUpload(f); if (p) paths.push("upload:" + p); }
                  setUploading(false);
                  set(q.id, [(q.options || [])[0] || "Use my photos", ...ups, ...paths]);
                  e.target.value = "";
                }} />
              </label>
            </div>
          )}
        </fieldset>
        {last && (
          <div className="mt-4">
            <label htmlFor="q-notes" className="mb-1.5 block text-xs text-muted-foreground">Anything else? (optional)</label>
            <Textarea id="q-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brand name, colours, must-have features…" className="resize-none" data-testid="input-notes" />
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          {i > 0 && <Button variant="ghost" className="h-10" onClick={() => setI(i - 1)} data-testid="button-q-back">Back</Button>}
          <button type="button" className="h-10 px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => submit(true)} disabled={busy} data-testid="button-q-skip">Skip, just build</button>
          {last ? (
            <Button className="ml-auto h-10" onClick={() => submit(false)} disabled={busy} data-testid="button-q-build">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Build it</Button>
          ) : (
            <Button variant="secondary" className="ml-auto h-10" onClick={() => setI(i + 1)} data-testid="button-q-next">Next<ArrowRight /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MessageView({ m, onRetry, retrying }: { m: Message; onRetry: () => void; retrying: boolean }) {
  if (m.role === "user") {
    const isAnswers = m.kind === "answers";
    if (m.meta?.via === "audit") return <div className="flex justify-end"><span className="inline-flex items-center gap-1.5 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="text-auto-polish"><Sparkles className="h-3.5 w-3.5" />Visual check found layout issues — polishing automatically</span></div>;
    if (isAnswers && m.content === "__skip__") return <div className="flex justify-end"><span className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Skipped questions — build with smart defaults</span></div>;
    return (
      <div className="flex flex-col items-end gap-1">
        {m.meta?.selection && <span className="max-w-[85%] truncate rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">↳ {m.meta.selection}</span>}
        <div className={cn("max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground", isAnswers && "bg-muted text-foreground")}>
          {isAnswers ? (
            <dl className="space-y-1.5 text-sm">{m.content.split("\n\n").map((blk, i) => { const [qq, a] = blk.split("\n→ "); return <div key={i}><dt className="text-xs text-muted-foreground">{qq}</dt><dd>{a}</dd></div>; })}</dl>
          ) : <Md text={m.content} />}
        </div>
      </div>
    );
  }
  const meta = m.meta || {};
  if ((m.kind === "build" || m.kind === "edit") && (meta.status === "error" || meta.status === "stopped")) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3" data-testid={`card-error-${m.id}`}>
        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><p className="text-sm">{meta.error || "That build didn't finish."}</p></div>
        <Button variant="outline" size="sm" className="mt-2 h-9" onClick={onRetry} disabled={retrying} data-testid="button-retry">{retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}Try again</Button>
        {meta.report?.steps && <div className="mt-3"><StepList steps={meta.report.steps} /></div>}
      </div>
    );
  }
  if (m.kind === "questions" && meta.status === "error") {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm">{meta.error || "Couldn't prepare questions."}</p>
        <Button variant="outline" size="sm" className="mt-2 h-9" onClick={onRetry} disabled={retrying} data-testid="button-retry-q"><RotateCcw />Try again</Button>
      </div>
    );
  }
  if (m.kind === "questions") return null; // rendered by the stepper / answers bubble
  if (!m.content && meta.status === "running") return null;
  return (
    <div className="space-y-1" data-testid={`msg-assistant-${m.id}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Stak</span>
        {meta.version && <span>· v{meta.version}</span>}
        {meta.model && <span>· {meta.model}</span>}
      </div>
      <Md text={m.content} />
      {meta.report && (meta.report.review || meta.report.security) && <ReportCard report={meta.report} />}
      {meta.report && !meta.report.review && !meta.report.security && meta.report.usage && <UsageLine usage={meta.report.usage} models={meta.report.models} duration={meta.report.duration} />}
    </div>
  );
}
