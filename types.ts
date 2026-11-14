// Stak API contract — shared between server/ (Express) and client/ (Vite + React).
// All endpoints are JSON; auth = `Authorization: Bearer <token>`; every request also sends `X-Stak-Model: <modelId>`.

export type Lang = "en" | "hi" | "hinglish" | "bn" | "ta" | "te" | "mr" | "gu" | "es" | "fr" | "de" | "pt" | "ar" | "ja";

// ---------------------------------------------------------------- auth
export interface User { id: string; name: string; email: string | null; guest: boolean; lang: Lang; created?: number }
export interface AuthResponse { user: User | null; token: string | null }           // POST /api/auth/guest|signup|login, GET /api/auth/me
export interface SignupBody { name: string; email: string; password: string; lang?: Lang }
export interface LoginBody { email: string; password: string }

// ---------------------------------------------------------------- projects
export type Stage = "questions" | "building" | "ready" | "error";
export type Files = Record<string, string>;                                           // path -> text content (index.html, styles.css, app.js, …)

export interface ProjectSummary {                                                     // GET /api/projects -> ProjectSummary[]
  id: string; title: string; prompt: string; lang: Lang; stage: Stage; version: number;
  created: number; updated: number; running: boolean;
}
export interface Project extends ProjectSummary { files: Files }
export interface VersionInfo { n: number; label: string; created: number }
export interface ProjectResponse { project: Project; messages: Message[]; versions: VersionInfo[]; activeJob: string | null } // GET /api/projects/:id
export interface CreateProjectBody { prompt: string; lang: Lang }                     // POST /api/projects -> { project, jobId }

// ---------------------------------------------------------------- questions
export type QuestionType = "single" | "multi" | "text" | "secret" | "images";
export interface Question {
  id: string;                         // q1, q2, …
  type: QuestionType;
  question: string;
  options?: string[];                 // single/multi; images: [ownLabel, aiLabel]
  placeholder?: string;
  secretName?: string;                // secret: UPPER_SNAKE env-style name, stored encrypted per project
  helpUrl?: string;
  optional?: boolean;
  showIf?: { q: string; any: string[] };
  slot?: string;                      // images: section slug, e.g. "portfolio"
  max?: number;                       // images: max uploads (default 12)
  aiNote?: string;                    // images: shown when the user lets Stak choose
}
// answers[qid] = selected values. For "images":
//   own photos -> [label, "upload:assets/uploads/a.jpg", "upload:assets/uploads/b.jpg", …]
//   AI photos  -> [label, "upload:ai"]
export interface AnswersBody { answers: Record<string, string[]>; notes: string; skip: boolean; secrets: Record<string, string>; lang: Lang } // POST /:id/answers -> { jobId }

// ---------------------------------------------------------------- messages
export type MessageKind = "text" | "questions" | "answers" | "build" | "edit";
export interface Message { id: number; projectId: string; role: "user" | "assistant"; kind: MessageKind; content: string; meta: MessageMeta; created: number }
export interface MessageMeta {
  status?: "loading" | "ready" | "running" | "done" | "error";
  questions?: Question[]; answered?: boolean; answers?: Record<string, string[]>; saved?: string[]; superseded?: boolean; phase?: string;
  skipped?: boolean;                                   // answers
  started?: number; files?: string[]; duration?: number; version?: number; model?: string; notes?: string[];
  verify?: { fixed: number; remaining: string[]; images: number };
  error?: string; selection?: string; via?: string;
}
export interface MessageBody { text: string; lang: Lang; selection: { selector: string; html: string; label?: string } | null; via: "text" | "voice" | "chat" } // POST /:id/messages -> { jobId }

// ---------------------------------------------------------------- jobs (polled every 700 ms)
export type JobPhase = "thinking" | "researching" | "planning" | `writing:${string}` | `images:${number}/${number}` | "verifying" | "repairing" | "finishing" | "done";
export interface JobView {                                                             // GET /api/jobs/:id?from=N
  status: "running" | "done" | "error" | "gone";
  phase: JobPhase; delta: string;                      // stream text from offset N: <stak-file path>…</stak-file>, <stak-patch path>…</stak-patch>, <stak-summary>…</stak-summary>
  doneFiles: string[]; elapsed: number; error: string | null; type: "questions" | "build" | "edit";
  model: string; plan?: string; notes?: string[]; sources?: WebSource[];
}

// ---------------------------------------------------------------- assets (photos)
export interface UploadBody { name: string; data: string }                             // POST /api/projects/:id/uploads (data = dataURL, ≤ 6 MB)
export interface UploadResponse { path: string; size: number; url: string }           // path like assets/uploads/photo-ab12c.jpg
export interface AssetInfo { path: string; kind: "upload" | "ai"; size: number; url: string; created: number } // GET /api/projects/:id/assets

// ---------------------------------------------------------------- secrets & cloud
export interface SecretInfo { name: string; preview: string; created?: number }        // GET/PUT/DELETE /api/projects/:id/secrets
export interface CloudOverview { collections: { name: string; count: number }[]; users: { id: string; name: string; email: string; created: number }[] } // GET /:id/cloud
export interface CloudDoc { id: string; owner: string | null; created: number; updated: number; [field: string]: unknown } // GET /:id/cloud/:table

// ---------------------------------------------------------------- models
export type ModelCategory = "fast" | "thinking" | "deep";
export interface BuiltinModel { id: "stak:pro" | "stak:think" | "stak:fast"; name: string; categories: ModelCategory[]; desc: string; sub: string }
export interface ProbeResult {
  formatOk: boolean; functional: boolean; jsonOk: boolean; fullstack: boolean; thinking: boolean;
  tps: number; ttftMs: number; score: number; categories: ModelCategory[]; recommend: string; error: string;
}
export interface UserModel { id: string; name: string; providerName: string; model: string; status: "testing" | "ready" | "chat" | "failed"; step: string; result: Partial<ProbeResult> }
export interface Provider { id: "nvidia" | "groq" | "openai"; name: string; help: string; keyPrefix: string; models: { id: string; name: string }[] }
export interface ModelsResponse { builtin: BuiltinModel[]; mine: UserModel[]; providers: Provider[]; selected: string } // GET /api/models
export interface AddModelsBody { provider: Provider["id"]; apiKey: string; baseUrl?: string; models: string[] }       // POST /api/models -> { ids }

// ---------------------------------------------------------------- generated-app runtime (Stak Cloud, /api/rt/:projectId)
// auth/signup|login|logout|me, db/:collection[/:id], ai/chat, fetch ({{SECRET}} substitution), secrets, files, assets/*

// ---------------------------------------------------------------- web search (v2)
export interface WebSource { title: string; url: string; snippet?: string }
export interface SearchResponse { results: WebSource[] }                                   // POST /api/search {q} · POST /api/rt/:id/web/search {q, limit?}
export interface WebAnswer { answer: string; sources: WebSource[]; provider: string }      // POST /api/rt/:id/web/answer {q}
export interface QuestionsMeta { questions: Question[]; research?: string[] }             // research = web queries the build should run first

// ---------------------------------------------------------------- mobile (v2, Android app)
export interface MobileActiveJob { jobId: string; projectId: string; title: string; type: "questions" | "build" | "edit"; phase: JobPhase; elapsed: number; progress: number; model: string }
export interface MobileSummary {                                                          // GET /api/mobile/summary
  user: { id: string; name: string; guest: boolean };
  stats: { projects: number; building: number; ready: number; needsAnswers: number };
  usage: { aiUsed: number; aiLimit: number };
  active: MobileActiveJob[];
  pending: { projectId: string; title: string; count: number }[];
  recent: { id: string; title: string; stage: string; running: boolean; updated: number; version: number; url: string | null; thumb: string | null }[];
  serverTime: number;
}
export type MobileEventType = "questions_ready" | "build_done" | "edit_done" | "job_failed";
export interface MobileEvent { id: number; type: MobileEventType; projectId: string; title: string; body: string; created: number }
export interface MobileEventsResponse { events: MobileEvent[]; last: number }              // GET /api/mobile/events?after=ID

// ---------------------------------------------------------------- status
export interface StatusResponse {                                                         // GET /api/status
  providers: Record<string, { configured: boolean; label: string }>;
  models: { id: string; ok: boolean | null; ms: number | null; error?: string }[];
  images: string[]; search: Record<"groq" | "tavily" | "brave" | "serper" | "free", boolean>; jobs: { running: number; max: number };
}
