# toggl-mcp

A small local **MCP server** for the [Toggl Track API v9](https://engineering.toggl.com/docs/), exposing the operations you actually use day to day:

| Tool | What it does |
|---|---|
| `list_time_entries` | List your time entries for a date range (defaults to last 7 days), optionally filtered by project/task or excluding a tag, with per-day, per-project, and **per-task** (`task_name`) totals. |
| `list_projects` | List your projects (to find the `project_id` the write tools need). |
| `create_task` | Create a task under a project. |
| `log_time` | Log a completed time entry, or start a running timer. Attach to a project/task. |
| `current_timer` | Show the currently running timer (with elapsed time), or report none. |
| `stop_timer` | Stop the running timer (or a specific entry by id). |
| `tag_time_entry` | Add/remove tags on an entry (e.g. mark `jira-logged` for dedupe). |

All the Toggl quirks are baked in: Basic-auth token handling, `https://api.track.toggl.com/api/v9` base, RFC3339/`YYYY-MM-DD` dates, seconds-based durations, default-workspace resolution.

## Prerequisites

- Node.js 18+ (built/tested on Node 26).
- A **Toggl Track API token** — get it at <https://track.toggl.com/profile> (bottom of the page). This is *not* the same as a Toggl Focus `toggl_sk_…` token.

## Build

```bash
git clone https://github.com/MikeAtPinnacle/toggl-mcp.git
cd toggl-mcp
npm install
npm run build
```

This compiles to `dist/index.js`. Note its **absolute path** — you'll point your MCP client at it below. The examples use `/absolute/path/to/toggl-mcp/dist/index.js` as a placeholder; on Windows that looks like `C:\\path\\to\\toggl-mcp\\dist\\index.js` (escape the backslashes in JSON).

## The API token

The server reads the token from **`TOGGL_API_TOKEN`** (or `TOGGL_TRACK_API_TOKEN` as a fallback). Auth is HTTP Basic with `base64(<token>:api_token)` — the server does that for you.

Provide the token via the MCP client's `env` block (below) so it stays scoped to this server and never collides with anything else.

## Register with Claude Desktop

Edit the Claude Desktop config file for your OS:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add (replace the path with your built `dist/index.js`):

```json
{
  "mcpServers": {
    "toggl": {
      "command": "node",
      "args": ["/absolute/path/to/toggl-mcp/dist/index.js"],
      "env": { "TOGGL_API_TOKEN": "<your_toggl_track_api_token>" }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the `toggl` server.

## Register with Claude Code

From any project (works on the CLI and the VS Code extension, which share this config):

```bash
claude mcp add toggl --scope user \
  --env TOGGL_API_TOKEN=<your_toggl_track_api_token> \
  -- node /absolute/path/to/toggl-mcp/dist/index.js
```

`--scope user` makes it available in every project; use `--scope local`/`project` to scope it. Verify with `claude mcp list`.

## Usage examples

Once the server is registered, just ask Claude in plain language — it picks the right tool and fills the parameters:

| You say | Tool used |
|---|---|
| "List my Toggl time entries for this week" | `list_time_entries` |
| "What did I track between June 1 and June 15?" | `list_time_entries` |
| "How much time did I spend on the Website project this month?" | `list_projects` → `list_time_entries` (project filter) |
| "Show my entries for that task last week" | `list_time_entries` (task filter) |
| "Show my Toggl projects" | `list_projects` |
| "Add a task called *Write design doc* to the Website project" | `list_projects` → `create_task` |
| "Log 90 minutes to the Website project for *code review*" | `list_projects` → `log_time` |
| "Start a Toggl timer for *standup*" | `log_time` (running) |
| "Is a timer running? How long?" | `current_timer` |
| "Stop my timer" | `stop_timer` |

### Tool inputs (for direct/programmatic calls)

**`list_time_entries`** — dates accept `YYYY-MM-DD` or RFC3339; `end_date` is exclusive; both default to the last 7 days. Optionally filter by `project_id` / `task_id`, or `exclude_tag` to skip already-processed entries (all client-side; the Toggl endpoint only takes dates). Each entry includes `project_name` and `task_name` (the Toggl task — e.g. a Jira key); output adds per-day, per-project, and per-task totals, and excludes running timers from totals.
```jsonc
// whole range
{ "start_date": "2026-06-22", "end_date": "2026-06-29" }

// one project
{ "start_date": "2026-06-01", "end_date": "2026-07-01", "project_id": 12345678 }

// a day's entries not yet pushed to Jira
{ "start_date": "2026-06-26", "end_date": "2026-06-27", "exclude_tag": "jira-logged" }
```
Returns a text summary plus `structuredContent` with `{ count, total_seconds, entries[] }`:
```
12 entries, total 18h 20m
Per day:
  2026-06-22: 6h 10m
  2026-06-23: 5h 45m

2026-06-22 13:15  0h 45m   Design review  [Website]
...
```

**`list_projects`** — find the `project_id` the write tools need.
```json
{ "active_only": true }
```

**`create_task`** — `project_id` + `name` required; `workspace_id` defaults to your default workspace.
```json
{ "project_id": 12345678, "name": "Write design doc", "estimated_seconds": 7200 }
```

**`log_time`** — log a completed entry, or start a running timer.
```jsonc
// completed entry (90 minutes, ending now)
{ "description": "Code review", "project_id": 12345678, "duration_seconds": 5400 }

// running timer (starts now; duration becomes -1 server-side)
{ "description": "Standup", "project_id": 12345678, "start_now": true }
```
`start` defaults to now (RFC3339 to override). Attach work with `project_id` and/or `task_id`. Optional: `billable`, `tags` (string names).

**`tag_time_entry`** — add (default) or remove tag names on an entry; other tags are preserved.
```json
{ "time_entry_id": 12345678, "tags": ["jira-logged"], "action": "add" }
```

**`current_timer`** — no arguments. Returns the running entry (with elapsed time) or `{ running: false }`.

**`stop_timer`** — no arguments stops whatever is running; or target a specific entry.
```json
{ "time_entry_id": 12345678 }
```

## Logging time to Jira (end-of-day worklog flow)

If you name each Toggl **task** after a Jira ticket (e.g. `LEGLINK-142`), `task_name` *is* the Jira key — so this server gives you the read + dedupe half of an end-of-day "push my tracked time to Jira worklogs" workflow. The Jira write is done by a **separate Jira MCP** (this server is Toggl-only; make sure yours supports `POST /issue/{key}/worklog`).

The flow Claude runs:

1. **Read** the day's loggable entries, skipping ones already pushed:
   `list_time_entries { start_date, end_date, exclude_tag: "jira-logged" }`
   — each entry carries `task_name` (the Jira key), `start`, and `duration` (seconds). Running timers are flagged and excluded from totals; skip them.
2. **Write** one Jira worklog per entry via your Jira MCP — `task_name` → issue key, `duration` → `timeSpentSeconds`, `start` → `started`, `description` → comment.
3. **Mark** each pushed entry so it won't be logged twice:
   `tag_time_entry { time_entry_id, tags: ["jira-logged"], action: "add" }`

Because step 1 filters `exclude_tag: "jira-logged"`, the job is **safe to re-run** — already-logged entries are skipped. Entries with no `task_id` (no Jira ticket) are simply left for you to handle.

## Smoke test (no MCP client needed)

```bash
export TOGGL_API_TOKEN="<your_toggl_track_api_token>"   # PowerShell: $env:TOGGL_API_TOKEN="..."
npm run build
npm run smoke
```

Prints your default workspace, first projects, and last-7-days entry count if the token works.

## Notes

- **stdio server:** logs go to stderr only; stdout is reserved for the MCP protocol.
- **Running timers:** `log_time` with `start_now: true` (or no `duration_seconds`) starts a timer (`duration = -1`); otherwise it logs a completed entry. Stop it with `stop_timer`.
- **Rate limits:** Toggl throttles aggressively (~1 req/s). The client automatically retries `429`/`5xx` with backoff (honoring `Retry-After`), so bursts of calls degrade gracefully instead of failing.
- **Upgrade path:** to distribute this without requiring Node on the target machine, repackage as an MCPB bundle.
