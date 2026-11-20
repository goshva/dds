/**
 * Этап 1.1 — тест исправленного discovery на КОПИИ каталога.
 * Проверяет: полная пагинация (count-сверка), статусы complete/incomplete, 1 req/s.
 * НЕ трогает data/catalog.sqlite.
 */
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

async function main() {
  const cfg = loadConfig();
  console.log("=== Discovery pagination test (readonly API) ===");
  console.log("baseUrl:", cfg.baseUrl, "| pageSize:", cfg.pageSize, "| maxPages:", cfg.maxPages, "| rateLimitMs:", cfg.rateLimitMs);

  const client = new SupersetClient(cfg);
  await client.login();
  console.log("login: ok");

  for (const resource of ["dashboard", "chart", "dataset"] as const) {
    const t0 = Date.now();
    try {
      const result = await client.listFull(resource);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `${resource}: api_count=${result.api_count} downloaded=${result.downloaded_count} pages=${result.pages_count} complete=${result.complete} (${dt}s)`
      );
      if (!result.complete) {
        console.error(`✗ ${resource}: INCOMPLETE — must not happen with fixed pagination`);
        process.exitCode = 1;
      }
    } catch (e: any) {
      console.error(`✗ ${resource}: ${e.name ?? "Error"}: ${String(e.message).slice(0, 200)}`);
      process.exitCode = 1;
    }
  }

  // Точечная проверка detail без слэша
  const d = await client.detail("dataset", 4732);
  console.log(`detail dataset/4732: table=${d?.result?.table_name} columns=${d?.result?.columns?.length} metrics=${d?.result?.metrics?.length}`);

  console.log("=== test finished, exit code:", process.exitCode ?? 0, "===");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
