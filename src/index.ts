import { loadConfig } from "./config";
import { SupersetClient } from "./superset";
import { runDiscovery } from "./discovery";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const command = Bun.argv[2] ?? "discovery";

async function main() {
  const cfg = loadConfig();
  const client = new SupersetClient(cfg);

  if (command === "health") {
    const started = new Date().toISOString();
    await client.login();
    await client.getCsrf();
    const result = {
      checked_at: started,
      base_url: cfg.baseUrl,
      authentication: "success",
      auth_mode: client.authMode(),
      csrf_endpoint: "checked; see console for warning if unavailable",
      read_only: true
    };
    await mkdir(cfg.outputDir, { recursive: true });
    await writeFile(join(cfg.outputDir, "health.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "discovery") {
    await client.login();
    await client.getCsrf();
    await runDiscovery(client, cfg);
    return;
  }

  if (command === "report") {
    const path = join(cfg.outputDir, "discovery_summary.json");
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error("Run `bun run discovery` first");
    console.log(await file.text());
    return;
  }

  throw new Error(`Unknown command: ${command}. Use health | discovery | report`);
}

main().catch(error => {
  console.error(`[FATAL] ${String(error)}`);
  process.exit(1);
});
