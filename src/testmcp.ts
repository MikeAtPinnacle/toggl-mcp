// Protocol-level test: spawn the built server over stdio and exercise it via the
// MCP client SDK. Run: node dist/testmcp.js  (needs TOGGL_API_TOKEN in env)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, "index.js")],
    env: { TOGGL_API_TOKEN: process.env.TOGGL_API_TOKEN ?? "" },
  });
  const client = new Client({ name: "toggl-mcp-test", version: "0.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));

  const proj = await client.callTool({ name: "list_projects", arguments: { active_only: true } });
  const projText = (proj.content as any[])[0]?.text ?? "";
  console.log("\n[list_projects]\n" + projText.split("\n").slice(0, 6).join("\n"));

  const te = await client.callTool({
    name: "list_time_entries",
    arguments: { start_date: "2026-06-22", end_date: "2026-06-27" },
  });
  const teText = (te.content as any[])[0]?.text ?? "";
  console.log("\n[list_time_entries]\n" + teText.split("\n").slice(0, 4).join("\n"));

  await client.close();
  console.log("\nOK: MCP protocol round-trip succeeded.");
}

main().catch((e) => {
  console.error("MCP TEST FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
