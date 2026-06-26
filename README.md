# toggl-mcp

A small local **MCP server** for the [Toggl Track API v9](https://engineering.toggl.com/docs/), exposing the operations you actually use day to day:

| Tool | What it does |
|---|---|
| `list_time_entries` | List your time entries for a date range (defaults to last 7 days) with per-day + total hours. |
| `list_projects` | List your projects (to find the `project_id` the write tools need). |
| `create_task` | Create a task under a project. |
| `log_time` | Log a completed time entry, or start a running timer. Attach to a project/task. |

All the Toggl quirks are baked in: Basic-auth token handling, `https://api.track.toggl.com/api/v9` base, RFC3339/`YYYY-MM-DD` dates, seconds-based durations, default-workspace resolution.

## Prerequisites

- Node.js 18+ (built/tested on Node 26).
- A **Toggl Track API token** — get it at <https://track.toggl.com/profile> (bottom of the page). This is *not* the same as a Toggl Focus `toggl_sk_…` token.

## Build

```powershell
cd C:\Users\MikeTherien\source\repos\toggl-mcp
npm install
npm run build
```

## The API token

The server reads the token from **`TOGGL_API_TOKEN`** (or `TOGGL_TRACK_API_TOKEN` as a fallback). Auth is HTTP Basic with `base64(<token>:api_token)` — the server does that for you.

Provide the token via the MCP client's `env` block (below) so it stays scoped to this server and never collides with anything else.

## Register with Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "toggl": {
      "command": "node",
      "args": ["C:\\Users\\MikeTherien\\source\\repos\\toggl-mcp\\dist\\index.js"],
      "env": { "TOGGL_API_TOKEN": "<your_toggl_track_api_token>" }
    }
  }
}
```

Restart Claude Desktop. The four tools appear under the `toggl` server.

## Register with Claude Code

From any project:

```powershell
claude mcp add toggl --env TOGGL_API_TOKEN=<your_toggl_track_api_token> -- node C:\Users\MikeTherien\source\repos\toggl-mcp\dist\index.js
```

(Use `--scope user` to make it available in every project, or `--scope local`/`project` to scope it.) Verify with `claude mcp list`.

## Usage examples

Once the server is registered, just ask Claude in plain language — it picks the right tool and fills the parameters:

| You say | Tool used |
|---|---|
| "List my Toggl time entries for this week" | `list_time_entries` |
| "What did I track between June 1 and June 15?" | `list_time_entries` |
| "Show my Toggl projects" | `list_projects` |
| "Add a task called *Write design doc* to the NHSNLink project" | `list_projects` → `create_task` |
| "Log 90 minutes to the Lantana Group project for *code review*" | `list_projects` → `log_time` |
| "Start a Toggl timer for *standup*" | `log_time` (running) |

### Tool inputs (for direct/programmatic calls)

**`list_time_entries`** — dates accept `YYYY-MM-DD` or RFC3339; `end_date` is exclusive; both default to the last 7 days.
```json
{ "start_date": "2026-06-22", "end_date": "2026-06-29" }
```
Returns a text summary plus `structuredContent` with `{ count, total_seconds, entries[] }`:
```
39 entries, total 34h 33m
Per day:
  2026-06-22: 8h 43m
  2026-06-23: 7h 57m

2026-06-22 13:15  0h 15m   CDC Setup / Troubleshooting  [proj 631918]
...
```

**`list_projects`** — find the `project_id` the write tools need.
```json
{ "active_only": true }
```

**`create_task`** — `project_id` + `name` required; `workspace_id` defaults to your default workspace.
```json
{ "project_id": 219977559, "name": "Write design doc", "estimated_seconds": 7200 }
```

**`log_time`** — log a completed entry, or start a running timer.
```jsonc
// completed entry (90 minutes, ending now)
{ "description": "Code review", "project_id": 219903480, "duration_seconds": 5400 }

// running timer (starts now; duration becomes -1 server-side)
{ "description": "Standup", "project_id": 219903480, "start_now": true }
```
`start` defaults to now (RFC3339 to override). Attach work with `project_id` and/or `task_id`. Optional: `billable`, `tags` (string names).

## Smoke test (no MCP client needed)

```powershell
$env:TOGGL_API_TOKEN = "<your_toggl_track_api_token>"
npm run build
npm run smoke
```

Prints your default workspace, first projects, and last-7-days entry count if the token works.

## Notes

- **stdio server:** logs go to stderr only; stdout is reserved for the MCP protocol.
- **Running timers:** `log_time` with `start_now: true` (or no `duration_seconds`) starts a timer (`duration = -1`); otherwise it logs a completed entry.
- **Upgrade path:** to distribute this without requiring Node on the target machine, repackage as an MCPB bundle.
