// Live WRITE test that cleans up after itself: creates a time entry and a task,
// prints them, then deletes both. Run: node dist/writetest.js (needs TOGGL_API_TOKEN).
import { logTime, createTask, listProjects, togglFetch, defaultWorkspaceId } from "./toggl.js";

async function main() {
  const ws = await defaultWorkspaceId();

  // --- time entry: create then delete ---
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const te = await logTime({
    description: "toggl-mcp write test (auto-deleted)",
    duration_seconds: 60,
    start: startedAt,
  });
  console.log(`time entry created: id=${te.id}, dur=${te.duration}s, desc="${te.description}"`);
  try {
    await togglFetch(`/workspaces/${te.workspace_id}/time_entries/${te.id}`, { method: "DELETE" });
    console.log(`time entry deleted: id=${te.id}`);
  } catch (e) {
    console.error(`!! FAILED to delete time entry ${te.id} — delete it manually:`, e);
    throw e;
  }

  // --- task: create then delete (under the first active project) ---
  const proj = (await listProjects(true))[0];
  if (!proj) {
    console.log("no active project found; skipping create_task test");
    return;
  }
  const task = await createTask({ project_id: proj.id, name: "toggl-mcp write test (auto-deleted)" });
  console.log(`task created: id=${task.id}, name="${task.name}", project=${proj.id} (${proj.name})`);
  try {
    await togglFetch(`/workspaces/${ws}/projects/${proj.id}/tasks/${task.id}`, { method: "DELETE" });
    console.log(`task deleted: id=${task.id}`);
  } catch (e) {
    console.error(`!! FAILED to delete task ${task.id} in project ${proj.id} — delete it manually:`, e);
    throw e;
  }

  console.log("\nOK: write paths (log_time, create_task) verified and cleaned up.");
}

main().catch((e) => {
  console.error("WRITE TEST FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
