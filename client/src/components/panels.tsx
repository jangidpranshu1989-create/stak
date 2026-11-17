import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Monitor, Smartphone, Tablet, RotateCw, ExternalLink, MousePointerClick, Copy, Check, Loader2, Trash2, KeyRound, Database, Users, History, FileCode2, ShieldCheck, Download, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, siteUrl, zipUrl, type Access, type Project, type Version } from "@/lib/api";
import { loadSiteDoc, saveSiteStore, validNavPath } from "@/lib/sitedoc";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { timeAgo } from "@/components/chrome";
import { cn } from "@/lib/utils";

export type Selection = { selector: string; html: string; label: string };
export type AuditIssue = { kind: string; selector: string; label: string; problem: string };
type Device = "desktop" | "tablet" | "mobile";
const DEVICE_W: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };

export function Preview({ project, onSelect, onError, onAudit, building }: { project: Project; onSelect: (s: Selection) => void; onError: (e: string) => void; onAudit?: (version: number, width: number, issues: AuditIssue[]) => void; building: boolean }) {
  const probe = useRef<HTMLIFrameElement>(null);
  const [probed, setProbed] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [pick, setPick] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const tok = useRef<string | null>(null);
  const [page, setPage] = useState("index.html");
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const url = `${project.id}:${project.version}:${page}:${nonce}`;

  useEffect(() => { setPage("index.html"); }, [project.id]);
  useEffect(() => {
    let alive = true;
    setLoaded(false); setFailed(null); setDoc(null);
    loadSiteDoc(project.id, page, project.version)
      .then((h) => { if (alive) setDoc(h); })
      .catch((e) => { if (alive) { setFailed(String(e?.message || e)); setLoaded(true); } });
    return () => { alive = false; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // talk to the preview agent injected into /api/site pages
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const d = e.data || {};
      // hidden 390px copy of the app: only its layout report matters
      if (probe.current && e.source === probe.current.contentWindow) {
        if (d.__stak === "audit") { onAudit?.(project.version, Number(d.width) || 390, Array.isArray(d.issues) ? d.issues.slice(0, 8) : []); setProbed(url); }
        return;
      }
      if (e.source !== frame.current?.contentWindow) return;
      if (d.__stak === "audit") { if (page === "index.html") onAudit?.(project.version, Number(d.width) || 0, Array.isArray(d.issues) ? d.issues.slice(0, 8) : []); return; }
      if (d.__stak === "hello") {
        try {
          if (!tok.current) tok.current = (await api<{ token: string }>("POST", `/api/projects/${project.id}/preview-token`)).token;
          frame.current?.contentWindow?.postMessage({ __stak: "preview-admin", token: tok.current }, "*");
        } catch { /* preview still works as a visitor */ }
        if (pick) frame.current?.contentWindow?.postMessage({ __stak: "pick", on: true }, "*");
      } else if (d.__stak === "select") {
        onSelect({ selector: String(d.selector || ""), html: String(d.html || ""), label: String(d.label || "element") });
        setPick(false);
      } else if (d.__stak === "store" && d.ns === "ls" && d.data && typeof d.data === "object") {
        saveSiteStore(project.id, d.data);
      } else if (d.__stak === "nav" && validNavPath(d.path)) {
        setPage(d.path || "index.html");
      } else if (d.__stak === "error") {
        onError(`${d.message}${d.source ? ` (${d.source}${d.line ? `:${d.line}` : ""})` : ""}`);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [project.id, project.version, pick, page, url, onSelect, onError, onAudit]);

  useEffect(() => { frame.current?.contentWindow?.postMessage({ __stak: "pick", on: pick }, "*"); }, [pick]);

  const w = DEVICE_W[device];
  const publicUrl = siteUrl(project.id);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Preview size">
          {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, I]) => (
            <button key={d} role="radio" aria-checked={device === d} aria-label={d} onClick={() => setDevice(d)} className={cn("grid h-8 w-9 place-items-center rounded-md text-muted-foreground transition-colors", device === d && "bg-background text-foreground shadow-sm")} data-testid={`button-device-${d}`}><I className="h-4 w-4" /></button>
          ))}
        </div>
        <Tooltip><TooltipTrigger asChild>
          <Button variant={pick ? "default" : "ghost"} size="sm" className="h-9" onClick={() => setPick(!pick)} disabled={building} aria-pressed={pick} data-testid="button-select-mode"><MousePointerClick />{pick ? "Click an element" : "Select"}</Button>
        </TooltipTrigger><TooltipContent>Click any element in the preview, then describe the change</TooltipContent></Tooltip>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setNonce(Date.now())} aria-label="Reload preview" data-testid="button-reload"><RotateCw /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Copy public link" data-testid="button-copy-link" onClick={() => { navigator.clipboard?.writeText(publicUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {}); }}>{copied ? <Check /> : <Copy />}</Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" asChild><a href={publicUrl} target="_blank" rel="noreferrer" aria-label="Open in new tab" data-testid="link-open-site"><ExternalLink /></a></Button>
        </div>
      </div>
      <div className={cn("relative min-h-0 flex-1 overflow-auto bg-muted/40", w && "p-4")}>
        {!loaded && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {failed && <div className="absolute inset-0 grid place-items-center p-6 text-center"><div><p className="text-sm font-medium">Preview couldn't load</p><p className="mt-1 text-xs text-muted-foreground">{failed}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setNonce(Date.now())}>Try again</Button></div></div>}
        {doc !== null && <iframe
          ref={frame}
          key={url}
          srcDoc={doc}
          title="App preview"
          onLoad={() => setLoaded(true)}
          className={cn("block h-full w-full bg-white transition-opacity", w && "mx-auto rounded-xl border shadow-sm", loaded ? "opacity-100" : "opacity-0")}
          style={w ? { width: w, maxWidth: "100%", height: device === "mobile" ? 780 : "100%" } : undefined}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          allow="clipboard-write; camera; microphone; geolocation"
          data-testid="iframe-preview"
        />}
        {doc !== null && !w && !building && page === "index.html" && probed !== url && onAudit && <iframe
          ref={probe}
          key={`probe:${url}`}
          srcDoc={doc}
          title="Mobile layout check"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute left-[-10000px] top-0"
          style={{ width: 390, height: 844 }}
          sandbox="allow-scripts"
        />}
      </div>
    </div>
  );
}

export function CodeView({ files, live }: { files: Record<string, string>; live?: string }) {
  const names = useMemo(() => Object.keys(files).filter((f) => !/^stak(-ui|-motion)?\.(js|css)$/.test(f)).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b))), [files]);
  const [cur, setCur] = useState<string>(names[0] || "");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!names.includes(cur)) setCur(names[0] || ""); }, [names, cur]);
  if (live) return <pre className="h-full overflow-auto bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground" data-testid="text-live-code">{live.slice(-12000)}</pre>;
  if (!names.length) return <Empty icon={FileCode2} title="No files yet" body="Code appears here as soon as the first build finishes." />;
  const src = files[cur] || "";
  const lines = src.split("\n");
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-48 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r" aria-label="Files">
        {names.map((n) => (
          <button key={n} onClick={() => setCur(n)} className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-left font-mono text-xs", n === cur ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")} data-testid={`button-file-${n}`}><FileCode2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{n}</span></button>
        ))}
      </nav>
      <div className="relative min-h-0 flex-1 overflow-auto bg-card">
        <Button variant="outline" size="sm" className="absolute right-3 top-3 z-10 h-8 bg-background" onClick={() => { navigator.clipboard?.writeText(src).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }} data-testid="button-copy-code">{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
        <pre className="min-w-max p-4 font-mono text-xs leading-[1.65]"><code>{lines.map((l, i) => <div key={i} className="flex"><span className="mr-4 inline-block w-8 shrink-0 select-none text-right tabular-nums text-muted-foreground/50">{i + 1}</span><span className="whitespace-pre">{l || " "}</span></div>)}</code></pre>
      </div>
    </div>
  );
}

function Empty({ icon: I, title, body }: { icon: any; title: string; body: string }) {
  return <div className="grid h-full place-items-center p-8 text-center"><div className="max-w-xs"><I className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><div className="text-sm font-medium">{title}</div><p className="mt-1 text-sm text-muted-foreground">{body}</p></div></div>;
}

const ACCESS: { v: Access; label: string }[] = [{ v: "public", label: "Anyone" }, { v: "auth", label: "Signed-in" }, { v: "owner", label: "Owner only" }, { v: "admin", label: "Admin only" }];

export function CloudView({ project }: { project: Project }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["cloud", project.id, project.version], queryFn: () => api<{ collections: { name: string; count: number; rule: Record<string, Access> }[]; users: { id: string; name: string; email: string; role: string; created: number }[]; rules: any }>("GET", `/api/projects/${project.id}/cloud`) });
  const [open, setOpen] = useState<string | null>(null);
  const docs = useQuery({ queryKey: ["cloud-docs", project.id, open], queryFn: () => api<any[]>("GET", `/api/projects/${project.id}/cloud/${encodeURIComponent(open!)}`), enabled: !!open });
  const saveRule = useMutation({
    mutationFn: async ({ col, op, v }: { col: string; op: string; v: Access }) => {
      const cur = q.data!; const rules = { collections: { ...(cur.rules?.collections || {}) } } as any;
      for (const c of cur.collections) rules.collections[c.name] = { ...c.rule, ...(rules.collections[c.name] || {}) };
      rules.collections[col] = { ...rules.collections[col], [op]: v };
      return api("PUT", `/api/projects/${project.id}/rules`, { rules });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cloud", project.id] }); toast({ title: "Access rule saved", description: "Enforced on the server right away." }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const setRole = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: string }) => api("PATCH", `/api/projects/${project.id}/cloud/users/${uid}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cloud", project.id] }),
  });
  if (q.isLoading) return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>;
  if (q.error) return <Empty icon={AlertTriangle} title="Couldn't load Stak Cloud" body={(q.error as any).message} />;
  const d = q.data!;
  const cols = docs.data || [];
  const keys = Array.from(new Set(cols.flatMap((x) => Object.keys(x)).filter((k) => !["id", "owner", "updated"].includes(k)))).slice(0, 6);
  return (
    <div className="h-full overflow-auto p-4">
      <section aria-labelledby="col-h">
        <h3 id="col-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" />Collections</h3>
        <p className="mb-3 text-xs text-muted-foreground">Access rules are checked by the server on every request, not by the app's code.</p>
        {d.collections.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">This project doesn't store data yet.</p> : (
          <div className="space-y-2">
            {d.collections.map((c) => (
              <div key={c.name} className="rounded-xl border bg-card">
                <button className="flex min-h-12 w-full items-center gap-3 px-3 text-left" onClick={() => setOpen(open === c.name ? null : c.name)} aria-expanded={open === c.name} data-testid={`button-collection-${c.name}`}>
                  <span className="font-mono text-sm">{c.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{c.count} item{c.count === 1 ? "" : "s"}</span>
                </button>
                <div className="grid grid-cols-2 gap-2 border-t px-3 py-3 sm:grid-cols-4">
                  {(["read", "create", "update", "delete"] as const).map((op) => (
                    <label key={op} className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{op}</span>
                      <Select value={c.rule[op]} onValueChange={(v) => saveRule.mutate({ col: c.name, op, v: v as Access })}>
                        <SelectTrigger className="h-9 text-xs" data-testid={`select-rule-${c.name}-${op}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{ACCESS.map((a) => <SelectItem key={a.v} value={a.v} className="text-xs">{a.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
                {open === c.name && (
                  <div className="overflow-x-auto border-t">
                    {docs.isLoading ? <div className="p-3 text-sm text-muted-foreground">Loading…</div> : cols.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No items yet.</div> : (
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/50 text-muted-foreground"><tr>{keys.map((k) => <th key={k} className="px-3 py-2 font-medium">{k}</th>)}</tr></thead>
                        <tbody className="divide-y">{cols.slice(0, 50).map((r) => <tr key={r.id}>{keys.map((k) => <td key={k} className="max-w-[220px] truncate px-3 py-2">{k === "created" ? timeAgo(r[k]) : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k] ?? "")}</td>)}</tr>)}</tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="mt-8" aria-labelledby="usr-h">
        <h3 id="usr-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />App users</h3>
        <p className="mb-3 text-xs text-muted-foreground">The first person to sign up becomes admin. In this preview you're always admin.</p>
        {d.users.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No one has signed up to this app yet.</p> : (
          <ul className="divide-y rounded-xl border bg-card">
            {d.users.map((u) => (
              <li key={u.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{u.name}</div><div className="truncate text-xs text-muted-foreground">{u.email}</div></div>
                <Select value={u.role || "user"} onValueChange={(role) => setRole.mutate({ uid: u.id, role })}>
                  <SelectTrigger className="h-9 w-28 text-xs" data-testid={`select-role-${u.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="user" className="text-xs">User</SelectItem><SelectItem value="admin" className="text-xs">Admin</SelectItem></SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function HistoryView({ project, versions, onRestored, busy }: { project: Project; versions: Version[]; onRestored: () => void; busy: boolean }) {
  const { toast } = useToast();
  const restore = useMutation({
    mutationFn: (n: number) => api("POST", `/api/projects/${project.id}/restore`, { n }),
    onSuccess: () => { onRestored(); toast({ title: "Version restored" }); },
    onError: (e: any) => toast({ title: "Couldn't restore", description: e.message, variant: "destructive" }),
  });
  if (!versions.length) return <Empty icon={History} title="No versions yet" body="Every build and edit is saved here so you can always go back." />;
  return (
    <ul className="h-full space-y-1 overflow-auto p-4">
      {versions.map((v) => (
        <li key={v.n} className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 py-2">
          <span className="w-10 font-mono text-xs tabular-nums text-muted-foreground">v{v.n}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-sm">{v.label}</div><div className="text-xs text-muted-foreground">{timeAgo(v.created)}</div></div>
          {v.n === project.version ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Live</span> : (
            <Button variant="outline" size="sm" className="h-9" onClick={() => restore.mutate(v.n)} disabled={busy || restore.isPending} data-testid={`button-restore-${v.n}`}>Restore</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SettingsView({ project }: { project: Project }) {
  const { toast } = useToast();
  const secrets = useQuery({ queryKey: ["secrets", project.id], queryFn: () => api<{ name: string; preview: string; created: number }[]>("GET", `/api/projects/${project.id}/secrets`) });
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<{ builtin: { id: string; name: string; desc: string; sub: string }[]; selected: string }>("GET", "/api/models") });
  const [name, setName] = useState(""); const [value, setValue] = useState("");
  const add = useMutation({
    mutationFn: () => api("PUT", `/api/projects/${project.id}/secrets`, { name: name.trim().toUpperCase(), value }),
    onSuccess: () => { setName(""); setValue(""); queryClient.invalidateQueries({ queryKey: ["secrets", project.id] }); toast({ title: "Key saved", description: "Encrypted on the server." }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: (n: string) => api("DELETE", `/api/projects/${project.id}/secrets/${encodeURIComponent(n)}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets", project.id] }) });
  const pickModel = useMutation({ mutationFn: (id: string) => api("PUT", "/api/models/selected", { id }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }) });
  return (
    <div className="h-full space-y-8 overflow-auto p-4">
      <section aria-labelledby="m-h">
        <h3 id="m-h" className="mb-3 text-sm font-semibold">Build engine</h3>
        <div className="grid gap-2">
          {(models.data?.builtin || []).filter((m) => m.id.startsWith("stak:")).map((m) => (
            <button key={m.id} onClick={() => pickModel.mutate(m.id)} className={cn("flex min-h-14 items-start gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors", models.data?.selected === m.id ? "border-primary ring-2 ring-primary/15" : "hover:border-foreground/25")} aria-pressed={models.data?.selected === m.id} data-testid={`button-model-${m.id}`}>
              <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full border-2", models.data?.selected === m.id ? "border-primary bg-primary" : "border-muted-foreground/40")} />
              <span className="min-w-0"><span className="block text-sm font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.desc}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">{m.sub}</span></span>
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="s-h">
        <h3 id="s-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />API keys for your app</h3>
        <p className="mb-3 text-xs text-muted-foreground">Use them in code as <code className="font-mono">{"{{NAME}}"}</code> with <code className="font-mono">stak.fetch</code>. Keys never reach the browser.</p>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (name && value) add.mutate(); }}>
          <Input className="h-10 font-mono sm:w-44" placeholder="NAME" value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} aria-label="Key name" data-testid="input-secret-name" />
          <Input className="h-10 flex-1 font-mono" type="password" autoComplete="off" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Key value" data-testid="input-secret-value" />
          <Button type="submit" className="h-10" disabled={!name || !value || add.isPending} data-testid="button-secret-add"><Plus />Add</Button>
        </form>
        <ul className="mt-3 divide-y rounded-xl border bg-card empty:hidden">
          {(secrets.data || []).map((s) => (
            <li key={s.name} className="flex min-h-11 items-center gap-3 px-3">
              <span className="font-mono text-sm">{s.name}</span><span className="font-mono text-xs text-muted-foreground">{s.preview}</span>
              <Button variant="ghost" size="icon" className="ml-auto h-9 w-9" onClick={() => del.mutate(s.name)} aria-label={`Delete ${s.name}`} data-testid={`button-secret-del-${s.name}`}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="e-h">
        <h3 id="e-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><Download className="h-4 w-4" />Export</h3>
        <p className="mb-3 text-xs text-muted-foreground">Full source as plain HTML, CSS and JS. Host it on Netlify, Vercel or GitHub Pages — sign-in, data and AI keep working through Stak Cloud.</p>
        <Button variant="outline" className="h-10" asChild disabled={!project.version}><a href={zipUrl(project.id)} data-testid="link-download-zip"><Download />Download ZIP</a></Button>
      </section>
      <section className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="h-4 w-4" />How your app is protected</div>
        Data access rules run on the server. Admin screens need an admin account. API keys are encrypted at rest and only used server-side. Each build gets a security scan.
      </section>
    </div>
  );
}
