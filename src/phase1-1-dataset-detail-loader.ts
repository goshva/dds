/**
 * Этап 1.1 — дозагрузка dataset_detail из Superset API.
 * - 1 запрос/сек (rate limiting)
 * - checkpoint в JSON после каждого успешного запроса → восстановление после обрыва
 * - приоритетные датасеты P0 → P1 загружаются первыми, остальные — по порядку
 * - только чтение, не модифицирует SQLite
 * - проверяет первые 5 датасетов перед массовой загрузкой
 */
import { writeFileSync, readFileSync } from "fs";
import { loadConfig } from "./config";

const config = loadConfig();
const API = config.baseUrl;
const CHECKPOINT_FILE = "data/checkpoint_dataset_detail.json";
const OUTPUT_FILE = "output/dataset_detail_batch.json";

// Приоритетные датасеты (P0 → P1)
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

type Checkpoint = {
  completed_ids: number[];
  failed_ids: number[];
  total_fetched: number;
  last_ts: string;
};

type DetailResult = {
  dataset_id: number;
  ok: boolean;
  status: number;
  error?: string;
  table_name?: string;
  kind?: string;
  database_name?: string;
  schema?: string;
  sql_length?: number;
  columns_count?: number;
  metrics_count?: number;
  changed_on?: string;
  sample_columns?: { name: string; type: string; }[];
  sample_metrics?: { name: string; expression: string; }[];
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login(): Promise<string> {
  const resp = await fetch(`${API}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
      provider: config.provider,
      refresh: true,
    }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  return data.access_token;
}

async function fetchDatasetDetail(token: string, datasetId: number): Promise<DetailResult> {
  // Без завершающего слэша!
  const url = `${API}/api/v1/dataset/${datasetId}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const result: DetailResult = {
    dataset_id: datasetId,
    ok: resp.ok,
    status: resp.status,
  };

  if (!resp.ok) {
    result.error = `HTTP ${resp.status}`;
    return result;
  }

  const data = await resp.json();
  const res = data.result;

  result.table_name = res.table_name;
  result.kind = res.kind;
  result.database_name = res.database?.database_name;
  result.schema = res.schema;
  result.changed_on = res.changed_on;

  // SQL
  if (res.sql) {
    result.sql_length = res.sql.length;
  }

  // Columns
  if (res.columns) {
    result.columns_count = res.columns.length;
    result.sample_columns = res.columns.slice(0, 5).map((c: any) => ({
      name: c.column_name,
      type: c.type || "",
    }));
  }

  // Metrics
  if (res.metrics) {
    result.metrics_count = res.metrics.length;
    result.sample_metrics = Object.entries(res.metrics).slice(0, 5).map(([k, v]: [string, any]) => ({
      name: k,
      expression: v?.expression || v?.verbose_name || "",
    }));
  }

  return result;
}

function loadCheckpoint(): Checkpoint {
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) as Checkpoint;
  } catch {
    return { completed_ids: [], failed_ids: [], total_fetched: 0, last_ts: "" };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), { mode: 0o600 });
}

async function main() {
  console.log("=== Dataset Detail Dataloader ===");
  console.log("Target:", API);
  console.log("Rate limit: 1 req/sec");
  console.log();

  // --- Phase 0: Login + check first 5 priority datasets ---
  console.log("[Phase 0] Login...");
  let token: string;
  try {
    token = await login();
    console.log("✓ Login successful");
  } catch (e: any) {
    console.error("✗ Login failed:", e.message);
    process.exit(1);
  }

  // Проверяем первые 5 датасетов
  const checkIds = PRIORITY_IDS.slice(0, 5);
  console.log(`\n[Phase 0] Checking ${checkIds.length} priority datasets (preview)...`);
  const previewResults: DetailResult[] = [];

  for (const id of checkIds) {
    console.log(`  Fetching dataset ${id}...`);
    const result = await fetchDatasetDetail(token, id);
    previewResults.push(result);

    if (result.ok) {
      console.log(`  ✓ ${id} ${result.table_name} | sql=${result.sql_length} cols=${result.columns_count} metrics=${result.metrics_count}`);
    } else {
      console.log(`  ✗ ${id} status=${result.status} ${result.error}`);
    }

    if (id !== checkIds[checkIds.length - 1]) {
      await sleep(1000); // 1 req/sec
    }
  }

  // Показываем sample данных
  const okResults = previewResults.filter((r) => r.ok);
  if (okResults.length > 0) {
    console.log("\n[Phase 0] Sample data from first OK result:");
    const first = okResults[0];
    console.log(`  table: ${first.table_name}`);
    console.log(`  database: ${first.database_name}`);
    console.log(`  sql_length: ${first.sql_length}`);
    console.log(`  columns_count: ${first.columns_count}`);
    if (first.sample_columns?.length) {
      console.log(`  sample columns:`);
      for (const c of first.sample_columns) {
        console.log(`    - ${c.name} (${c.type})`);
      }
    }
    if (first.sample_metrics?.length) {
      console.log(`  sample metrics:`);
      for (const m of first.sample_metrics) {
        console.log(`    - ${m.name}: ${m.expression.slice(0, 80)}`);
      }
    }
  }

  console.log(`\n[Phase 0] Preview complete: ${okResults.length}/${checkIds.length} ok`);
  if (okResults.length === 0) {
    console.error("✗ No datasets fetched — aborting batch load");
    return;
  }

  // --- Phase 1: Batch load with checkpoint ---
  console.log("\n[Phase 1] Batch load with checkpoint...");
  const cp = loadCheckpoint();
  console.log(`  Resumed from checkpoint: ${cp.completed_ids.length} completed, ${cp.failed_ids.length} failed`);

  // Загружаем все приоритетные, пропуская уже выполненные
  const allIds = [...PRIORITY_IDS];
  const toFetch = allIds.filter((id) => !cp.completed_ids.includes(id) && !cp.failed_ids.includes(id));
  console.log(`  To fetch: ${toFetch.length} datasets (${allIds.length - toFetch.length} already processed)`);

  const batchResults: DetailResult[] = [];
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;

  for (let i = 0; i < toFetch.length; i++) {
    const id = toFetch[i];
    const percent = Math.round(((cp.completed_ids.length + i) / toFetch.length) * 100);
    console.log(`  [${i + 1}/${toFetch.length}] (${percent}%) Fetching dataset ${id}...`);

    try {
      const result = await fetchDatasetDetail(token, id);
      batchResults.push(result);

      if (result.ok) {
        cp.completed_ids.push(id);
        consecutiveErrors = 0;
        console.log(`    ✓ ${result.table_name} | sql=${result.sql_length} cols=${result.columns_count}`);
      } else {
        cp.failed_ids.push(id);
        console.log(`    ✗ status=${result.status} ${result.error}`);
      }

      saveCheckpoint(cp);
      cp.total_fetched++;
      cp.last_ts = new Date().toISOString();

    } catch (e: any) {
      console.error(`    ✗ Network error: ${e.message}`);
      cp.failed_ids.push(id);
      consecutiveErrors++;
      saveCheckpoint(cp);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n✗ ${MAX_CONSECUTIVE_ERRORS} consecutive errors — stopping to avoid spam`);
        break;
      }

      // Retry с exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
      console.log(`    Retrying in ${retryDelay}ms...`);
      await sleep(retryDelay);
    }

    // Rate limiting: 1 req/sec
    if (i < toFetch.length - 1) {
      await sleep(1000);
    }
  }

  // Итоговый отчёт
  const okCount = batchResults.filter((r) => r.ok).length;
  const failCount = batchResults.filter((r) => !r.ok).length;

  console.log("\n=== Batch Load Complete ===");
  console.log(`Fetched: ${batchResults.length} datasets (${okCount} ok, ${failCount} failed)`);
  console.log(`Checkpoint: ${cp.completed_ids.length} completed, ${cp.failed_ids.length} failed, total=${cp.total_fetched}`);

  // Сохраняем batch-результаты
  writeFileSync(OUTPUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    batch: batchResults,
    checkpoint: cp,
  }, null, 2), { mode: 0o600 });

  console.log(`Saved to ${OUTPUT_FILE}`);

  // Выводим полную сводку по всем датасетам (checkpoint + batch)
  console.log("\n=== Full Summary ===");
  for (const id of PRIORITY_IDS) {
    const wasInCheckpoint = cp.completed_ids.includes(id);
    const wasFailed = cp.failed_ids.includes(id);
    const inBatch = batchResults.find((r) => r.dataset_id === id);
    const ok = wasInCheckpoint || (inBatch && inBatch.ok);
    console.log(`${ok ? "✓" : "✗"} ${id} ${wasInCheckpoint ? "(checkpoint)" : inBatch ? "(new)" : "(pending)"}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
