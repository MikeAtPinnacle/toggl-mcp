// Standalone smoke test: hits the live Toggl Track API using TOGGL_API_TOKEN.
// Run: node dist/smoke.js   (after `npm run build`)
import { defaultWorkspaceId, listProjects, listTimeEntries, fmtDuration } from "./toggl.js";

async function main() {
  const ws = await defaultWorkspaceId();
  console.log("default_workspace_id:", ws);

  const projects = await listProjects();
  console.log(`projects: ${projects.length}`);
  for (const p of projects.slice(0, 10)) console.log(`  ${p.id}  ${p.active ? " " : "x"} ${p.name}`);

  const entries = await listTimeEntries({});
  const total = entries.reduce((s, e) => s + (e.duration > 0 ? e.duration : 0), 0);
  console.log(`time entries (last 7d): ${entries.length}, total ${fmtDuration(total)}`);
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
