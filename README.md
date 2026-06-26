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
