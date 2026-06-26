#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listTimeEntries,
  listProjects,
  projectNameMap,
  createTask,
  logTime,
  getCurrentTimeEntry,
  stopTimeEntry,
  stopCurrentTimer,
  defaultWorkspaceId,
  fmtDuration,
  type TimeEntry,
} from "./toggl.js";

const server = new McpServer({ name: "toggl-mcp", version: "0.1.0" });

const ok = (text: string, structured?: unknown) => ({
  content: [{ type: "text" as const, text }],
  ...(structured !== undefined ? { structuredContent: structured as any } : {}),
});
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// ---- list_time_entries ------------------------------------------------------

server.registerTool(
  "list_time_entries",
  {
    title: "List time entries",
    description:
      "List the authenticated user's Toggl Track time entries within a date range, " +
      "optionally filtered to a specific project and/or task. " +
      "Dates accept YYYY-MM-DD or full RFC3339. end_date is exclusive. " +
      "Defaults to the last 7 days when omitted. Returns each entry plus per-day, per-project, and total hours. " +
      "duration is in seconds; a negative duration means the timer is currently running. " +
      "Use list_projects to find a project_id.",
    inputSchema: {
      start_date: z.string().optional().describe("Range start, YYYY-MM-DD or RFC3339. Default: 7 days ago."),
      end_date: z.string().optional().describe("Range end (exclusive), YYYY-MM-DD or RFC3339. Default: tomorrow."),
      project_id: z.number().int().optional().describe("Only entries on this project (see list_projects)."),
      task_id: z.number().int().optional().describe("Only entries on this task."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      const entries = await listTimeEntries(args);
      const names = await projectNameMap();
      const projLabel = (id: number | null) =>
        id ? `${names.get(id) ?? `proj ${id}`}` : "(no project)";

      const byDay = new Map<string, number>();
      const byProject = new Map<string, number>();
      let total = 0;
      for (const e of entries) {
        const secs = e.duration > 0 ? e.duration : 0;
        total += secs;
        byDay.set(e.start.slice(0, 10), (byDay.get(e.start.slice(0, 10)) ?? 0) + secs);
        const pl = projLabel(e.project_id);
        byProject.set(pl, (byProject.get(pl) ?? 0) + secs);
      }
      const lines = entries
        .slice()
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((e: TimeEntry) =>
          `${e.start.slice(0, 16).replace("T", " ")}  ${fmtDuration(e.duration).padEnd(8)}  ` +
          `${e.description ?? "(no description)"}` +
          `${e.project_id ? `  [${projLabel(e.project_id)}]` : ""}${e.task_id ? `  [task ${e.task_id}]` : ""}`,
        );
      const daySummary = [...byDay.entries()].sort().map(([d, s]) => `  ${d}: ${fmtDuration(s)}`).join("\n");
      const projSummary = [...byProject.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([p, s]) => `  ${p}: ${fmtDuration(s)}`)
        .join("\n");
      const filterNote =
        (args.project_id ? ` · project ${projLabel(args.project_id)}` : "") +
        (args.task_id ? ` · task ${args.task_id}` : "");
      const summary =
        `${entries.length} entries, total ${fmtDuration(total)}${filterNote}\n` +
        (daySummary ? `Per day:\n${daySummary}\n` : "") +
        (byProject.size > 1 ? `Per project:\n${projSummary}\n` : "") +
        "\n" + lines.join("\n");
      return ok(summary, { count: entries.length, total_seconds: total, entries });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- list_projects ----------------------------------------------------------

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description:
      "List the authenticated user's Toggl Track projects (id, name, active, workspace). " +
      "Use this to find the project_id needed by create_task and log_time.",
    inputSchema: {
      active_only: z.boolean().optional().describe("Only return active projects. Default: all."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      const projects = await listProjects(args.active_only ? true : undefined);
      const lines = projects
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => `${String(p.id).padEnd(12)} ${p.active ? " " : "x"} ${p.name}`);
      return ok(
        `${projects.length} projects (id, active, name):\n${lines.join("\n")}`,
        { count: projects.length, projects },
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- create_task ------------------------------------------------------------

server.registerTool(
  "create_task",
  {
    title: "Create a task",
    description:
      "Create a task under a Toggl Track project. Requires the project_id (see list_projects) and a name. " +
      "workspace_id defaults to your default workspace.",
    inputSchema: {
      project_id: z.number().int().describe("The project to create the task under."),
      name: z.string().min(1).describe("Task name."),
      workspace_id: z.number().int().optional().describe("Override workspace. Defaults to your default workspace."),
      active: z.boolean().optional().describe("Whether the task is active. Default true on Toggl's side."),
      estimated_seconds: z.number().int().optional().describe("Time estimate in seconds."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args) => {
    try {
      const task = await createTask(args);
      return ok(`Created task "${task.name}" (id ${task.id}) under project ${task.project_id}.`, task);
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- log_time ---------------------------------------------------------------

server.registerTool(
  "log_time",
  {
    title: "Log time",
    description:
      "Create a Toggl Track time entry. To log a COMPLETED entry, provide duration_seconds (>0) and " +
      "optionally start (defaults to now). To START a running timer, set start_now=true (or omit duration). " +
      "Attach it to work via project_id and/or task_id (see list_projects). workspace_id defaults to your default workspace.",
    inputSchema: {
      description: z.string().optional().describe("What you worked on."),
      project_id: z.number().int().optional().describe("Project to attach the entry to."),
      task_id: z.number().int().optional().describe("Task to attach the entry to."),
      duration_seconds: z.number().int().optional().describe("Length in seconds for a completed entry. Omit (or start_now) to start a running timer."),
      start: z.string().optional().describe("Start time, RFC3339. Default: now."),
      start_now: z.boolean().optional().describe("Start a running timer now instead of logging a completed entry."),
      billable: z.boolean().optional().describe("Mark the entry billable."),
      tags: z.array(z.string()).optional().describe("Tag names to attach."),
      workspace_id: z.number().int().optional().describe("Override workspace. Defaults to your default workspace."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args) => {
    try {
      const te = await logTime(args);
      const state = te.duration < 0 ? "running timer started" : `logged ${fmtDuration(te.duration)}`;
      return ok(
        `Time entry created (id ${te.id}): ${state}` +
          `${te.description ? ` — "${te.description}"` : ""}` +
          `${te.project_id ? `  [proj ${te.project_id}]` : ""}${te.task_id ? `  [task ${te.task_id}]` : ""}`,
        te,
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- current_timer ----------------------------------------------------------

function describeRunning(te: TimeEntry): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(te.start).getTime()) / 1000));
  return (
    `Running ${fmtDuration(elapsed)} (since ${te.start.slice(0, 16).replace("T", " ")})` +
    `${te.description ? ` — "${te.description}"` : ""}` +
    `${te.project_id ? `  [proj ${te.project_id}]` : ""}${te.task_id ? `  [task ${te.task_id}]` : ""}` +
    `  (id ${te.id})`
  );
}

server.registerTool(
  "current_timer",
  {
    title: "Current running timer",
    description:
      "Return the time entry whose timer is currently running (with elapsed time), or report that no timer is running.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const te = await getCurrentTimeEntry();
      if (!te) return ok("No timer is currently running.", { running: false, entry: null });
      return ok(describeRunning(te), { running: true, entry: te });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- stop_timer -------------------------------------------------------------

server.registerTool(
  "stop_timer",
  {
    title: "Stop the running timer",
    description:
      "Stop a running Toggl Track timer. With no arguments, stops whatever timer is currently running. " +
      "Pass time_entry_id (and workspace_id) to stop a specific entry. No-op if nothing is running.",
    inputSchema: {
      time_entry_id: z.number().int().optional().describe("Specific entry to stop. Default: the current running timer."),
      workspace_id: z.number().int().optional().describe("Workspace of that entry. Defaults to your default workspace."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      let te: TimeEntry | null;
      if (args.time_entry_id !== undefined) {
        const ws = args.workspace_id ?? (await defaultWorkspaceId());
        te = await stopTimeEntry(ws, args.time_entry_id);
      } else {
        te = await stopCurrentTimer();
      }
      if (!te) return ok("No timer was running; nothing to stop.", { stopped: false, entry: null });
      return ok(
        `Stopped timer (id ${te.id}): logged ${fmtDuration(te.duration)}` +
          `${te.description ? ` — "${te.description}"` : ""}`,
        { stopped: true, entry: te },
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- start ------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Resolve the default workspace early so a bad token fails loudly at startup
  // (stderr only — never write to stdout on a stdio MCP server).
  try {
    await defaultWorkspaceId();
    console.error("toggl-mcp: connected, default workspace resolved.");
  } catch (e) {
    console.error(`toggl-mcp: WARNING — could not reach Toggl at startup: ${e instanceof Error ? e.message : e}`);
  }
}

main().catch((e) => {
  console.error("toggl-mcp fatal:", e);
  process.exit(1);
});
