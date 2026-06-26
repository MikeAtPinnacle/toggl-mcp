// Thin client for the Toggl Track API v9.
// Auth: HTTP Basic with base64("<api_token>:api_token").
// Docs: https://engineering.toggl.com/docs/

const BASE = "https://api.track.toggl.com/api/v9";
const CREATED_WITH = "toggl-mcp";

function getToken(): string {
  const t = process.env.TOGGL_API_TOKEN || process.env.TOGGL_TRACK_API_TOKEN;
  if (!t) {
    throw new Error(
      "No API token. Set TOGGL_API_TOKEN (your Toggl Track API token, from " +
        "https://track.toggl.com/profile) in the MCP server's env config.",
    );
  }
  return t;
}

function authHeader(): string {
  // Toggl Track uses Basic auth with the api token as the username and the
  // literal string "api_token" as the password.
  return "Basic " + Buffer.from(`${getToken()}:api_token`).toString("base64");
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_ATTEMPTS = 4;

export async function togglFetch<T = any>(
  path: string,
  init: RequestInit = {},
  attempt = 1,
): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // Toggl rate-limits aggressively (~1 req/s). Back off on 429 / 5xx and retry,
  // honoring Retry-After when present, otherwise exponential backoff.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 400 * 2 ** (attempt - 1));
    await delay(waitMs);
    return togglFetch<T>(path, init, attempt + 1);
  }

  const text = await res.text();
  if (!res.ok) {
    const method = (init.method ?? "GET").toUpperCase();
    throw new Error(
      `Toggl API ${res.status} ${res.statusText} on ${method} ${path}` +
        (text ? `: ${text}` : ""),
    );
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ---- workspace defaulting ---------------------------------------------------

let _defaultWs: number | undefined;

export async function defaultWorkspaceId(): Promise<number> {
  if (_defaultWs) return _defaultWs;
  const me = await togglFetch<{ default_workspace_id: number }>("/me");
  if (!me?.default_workspace_id) {
    throw new Error("Could not resolve default workspace from /me.");
  }
  _defaultWs = me.default_workspace_id;
  return _defaultWs;
}

// ---- date helpers -----------------------------------------------------------

/** Accept a YYYY-MM-DD or full RFC3339 string and return it unchanged; if it is
 *  a bare date leave it (Toggl accepts both for start_date/end_date). */
function passDate(s: string): string {
  return s;
}

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---- types ------------------------------------------------------------------

export interface TimeEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  project_name: string | null; // populated when fetched with meta=true
  task_id: number | null;
  task_name: string | null; // populated when fetched with meta=true (e.g. the Jira key)
  description: string | null;
  start: string;
  stop: string | null;
  duration: number; // seconds; negative => currently running
  billable: boolean;
  tags: string[] | null;
}

export interface Project {
  id: number;
  workspace_id: number;
  name: string;
  active: boolean;
  client_id: number | null;
  color: string | null;
}

// ---- operations -------------------------------------------------------------

export async function listTimeEntries(opts: {
  start_date?: string;
  end_date?: string;
  project_id?: number;
  task_id?: number;
  exclude_tag?: string;
}): Promise<TimeEntry[]> {
  // Default to the last 7 days. end_date is exclusive in Toggl Track, so add a day.
  const start = opts.start_date ? passDate(opts.start_date) : isoDaysFromNow(-7);
  const end = opts.end_date ? passDate(opts.end_date) : isoDaysFromNow(1);
  // meta=true enriches each entry with project_name / task_name (the Jira key).
  const qs = new URLSearchParams({ start_date: start, end_date: end, meta: "true" });
  let entries = await togglFetch<TimeEntry[]>(`/me/time_entries?${qs.toString()}`);
  // /me/time_entries has no project/task query params, so filter client-side.
  if (opts.project_id !== undefined)
    entries = entries.filter((e) => e.project_id === opts.project_id);
  if (opts.task_id !== undefined)
    entries = entries.filter((e) => e.task_id === opts.task_id);
  if (opts.exclude_tag !== undefined)
    entries = entries.filter((e) => !(e.tags ?? []).includes(opts.exclude_tag!));
  return entries;
}

/** Add or remove tag names on an existing entry (tags are auto-created).
 *  Uses Toggl's tag_action so other tags are preserved. */
export async function setEntryTags(
  workspaceId: number,
  timeEntryId: number,
  tags: string[],
  action: "add" | "delete",
): Promise<TimeEntry> {
  return togglFetch<TimeEntry>(
    `/workspaces/${workspaceId}/time_entries/${timeEntryId}`,
    { method: "PUT", body: JSON.stringify({ tags, tag_action: action }) },
  );
}

/** Map of project id -> name, for labelling time-entry output. Best-effort. */
export async function projectNameMap(): Promise<Map<number, string>> {
  try {
    const ps = await listProjects();
    return new Map(ps.map((p) => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

export async function getCurrentTimeEntry(): Promise<TimeEntry | null> {
  // Returns the running entry, or null when no timer is running.
  return togglFetch<TimeEntry | null>("/me/time_entries/current");
}

export async function stopTimeEntry(
  workspaceId: number,
  timeEntryId: number,
): Promise<TimeEntry> {
  return togglFetch<TimeEntry>(
    `/workspaces/${workspaceId}/time_entries/${timeEntryId}/stop`,
    { method: "PATCH" },
  );
}

/** Stop whatever timer is currently running. Returns the stopped entry, or null
 *  if nothing was running. */
export async function stopCurrentTimer(): Promise<TimeEntry | null> {
  const current = await getCurrentTimeEntry();
  if (!current) return null;
  return stopTimeEntry(current.workspace_id, current.id);
}

export async function listProjects(active?: boolean): Promise<Project[]> {
  const all = await togglFetch<Project[]>("/me/projects");
  if (active === undefined) return all ?? [];
  return (all ?? []).filter((p) => p.active === active);
}

export async function createTask(opts: {
  workspace_id?: number;
  project_id: number;
  name: string;
  active?: boolean;
  estimated_seconds?: number;
  user_id?: number;
}): Promise<any> {
  const ws = opts.workspace_id ?? (await defaultWorkspaceId());
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.active !== undefined) body.active = opts.active;
  if (opts.estimated_seconds !== undefined)
    body.estimated_seconds = opts.estimated_seconds;
  if (opts.user_id !== undefined) body.user_id = opts.user_id;
  return togglFetch(
    `/workspaces/${ws}/projects/${opts.project_id}/tasks`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function logTime(opts: {
  workspace_id?: number;
  description?: string;
  project_id?: number;
  task_id?: number;
  start?: string;
  duration_seconds?: number;
  start_now?: boolean;
  billable?: boolean;
  tags?: string[];
}): Promise<any> {
  const ws = opts.workspace_id ?? (await defaultWorkspaceId());
  const start = opts.start ?? new Date().toISOString();

  // Running timer when start_now is set or no positive duration is given.
  const running =
    opts.start_now === true ||
    opts.duration_seconds === undefined ||
    opts.duration_seconds < 0;
  const duration = running ? -1 : opts.duration_seconds!;

  const body: Record<string, unknown> = {
    created_with: CREATED_WITH,
    workspace_id: ws,
    start,
    duration,
  };
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.project_id !== undefined) body.project_id = opts.project_id;
  if (opts.task_id !== undefined) body.task_id = opts.task_id;
  if (opts.billable !== undefined) body.billable = opts.billable;
  if (opts.tags !== undefined) body.tags = opts.tags;

  return togglFetch(`/workspaces/${ws}/time_entries`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Format seconds as "Hh Mm" for human-readable summaries. */
export function fmtDuration(seconds: number): string {
  if (seconds < 0) return "running";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
