// Live, self-cleaning check of the running-timer path: start -> current -> stop
// -> verify stopped -> delete. Paced to respect Toggl's ~1 req/s rate limit.
// Refuses to run if a timer is already active, so it never disturbs real work.
// Run: node dist/stopcheck.js   (needs TOGGL_API_TOKEN)
import {
  logTime,
  getCurrentTimeEntry,
  stopCurrentTimer,
  togglFetch,
} from "./toggl.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const PACE = 1500; // ms between calls

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  // Guard: don't touch an existing running timer.
  const pre = await getCurrentTimeEntry();
  if (pre) {
    console.log(
      `A timer is already running (id ${pre.id}, "${pre.description ?? ""}"). ` +
        "Aborting so we don't disturb it — stop it first, then re-run.",
    );
    return;
  }

  let createdId: number | undefined;
  let workspaceId: number | undefined;
  try {
    // 1) start a throwaway running timer
    const started = await logTime({
      description: "toggl-mcp stop_timer check (auto-deleted)",
      start_now: true,
    });
    createdId = started.id;
    workspaceId = started.workspace_id;
    assert(started.duration < 0, "new timer should be running (duration < 0)");
    console.log(`1) started running timer id=${started.id} (duration=${started.duration})`);
    await sleep(PACE);

    // 2) current_timer should report it
    const cur = await getCurrentTimeEntry();
    assert(cur?.id === started.id, "current_timer should report the started timer");
    console.log(`2) current_timer reports id=${cur?.id} ✓`);
    await sleep(PACE);

    // 3) stop it -> duration should flip positive
    const stopped = await stopCurrentTimer();
    assert(!!stopped && stopped.id === started.id, "stop should return the same entry");
    assert((stopped!.duration ?? -1) >= 0, "stopped entry should have a non-negative duration");
    console.log(`3) stopped id=${stopped!.id}, duration=${stopped!.duration}s ✓`);
    await sleep(PACE);

    // 4) current_timer should now be empty
    const after = await getCurrentTimeEntry();
    assert(after === null, "no timer should be running after stop");
    console.log(`4) current_timer now empty ✓`);
  } finally {
    // 5) always clean up the throwaway entry
    if (createdId && workspaceId) {
      await sleep(PACE);
      try {
        await togglFetch(`/workspaces/${workspaceId}/time_entries/${createdId}`, { method: "DELETE" });
        console.log(`5) deleted throwaway entry id=${createdId} ✓`);
      } catch (e) {
        console.error(`!! FAILED to delete entry ${createdId} — delete it manually:`, e);
      }
    }
  }

  console.log("\nOK: stop_timer live path verified and cleaned up.");
}

main().catch((e) => {
  console.error("STOP CHECK FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
