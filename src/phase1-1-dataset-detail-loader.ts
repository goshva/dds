/**
 * Этап 1.1 — дозагрузка dataset_detail из Superset API (переписан по ТЗ раздела 3).
 *
 * Поведение:
 *  - единая fetchDetail() для preview и batch; результаты preview переиспользуются;
 *  - полный ответ API сохраняется атомарно в output/dataset_details/<id>.json;
 *  - summary — только сводка/статусы (output/dataset_detail_summary.json);
 *  - checkpoint: completed_ids, failed_ids (с классификацией), attempts, results, file_path, validation;
 *  - completed = HTTP ok + структура result проверена + файл сохранён + файл перечитан и валиден;
 *  - при восстановлении: completed без валидного файла → повтор загрузки;
 *  - сетевые/преходящие ошибки НЕ попадают в перманентный failed_ids;
 *  - 401 — re-auth (один повтор запроса) через SupersetClient; 429/5xx/network — backoff; 403/404 — финальная ошибка;
 *  - последовательно, 1 запрос/сек (RATE_LIMIT_MS).
 */
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

const config = loadConfig();
const DETAILS_DIR = "output/dataset_details";
const CHECKPOINT_FILE = "data/checkpoint_dataset_detail.json";
const SUMMARY_FILE = "output/dataset_detail_summary.json";

// Приоритетные ID без изменений (ТЗ раздел 3)
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

type ValidationResult = "valid" | "invalid_structure" | "file_missing" | "file_corrupt";

type IdResult = {
  dataset_id: number;
  ok: boolean;
  http_status: number | null;
  error?: string;
  error_class?: "permanent" | "transient"; // permanent: 403/404; transient: сеть/таймаут/5xx после ретраев
  table_name?: string;
  sql_length?: number;
  columns_count?: number;
  metrics_count?: number;
  changed_on?: string;
  file_path?: string;
  validation?: ValidationResult;
  fetched_at?: string;
};

type Checkpoint = {
  completed_ids: number[];
  failed_ids: number[];          // только PERMANENT failures (403/404/структура)
  transient_failures: number[];  // сеть/5xx — будут повторены на следующем запуске
  attempts: Record<string, number>;
  results: Record<string, IdResult>;
  total_fetched: number;
  last_ts: string;
};

function loadCheckpoint(): Checkpoint {
  try {
    const cp = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) as Checkpoint;
    return {
      completed_ids: cp.completed_ids ?? [],
      failed_ids: cp.failed_ids ?? [],
      transient_failures: cp.transient_failures ?? [],
      attempts: cp.attempts ?? {},
      results: cp.results ?? {},
      total_fetched: cp.total_fetched ?? 0,
      last_ts: cp.last_ts ?? "",
    };
  } catch {
    return { completed_ids: [], failed_ids: [], transient_failures: [], attempts: {}, results: {}, total_fetched: 0, last_ts: "" };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  atomicWrite(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

/** Атомарная запись: temp-файл + rename. */
function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Валидация структуры detail-ответа Superset. */
function validateStructure(data: any): { ok: boolean; reason?: string } {
  const res = data?.result;
  if (!res || typeof res !== "object") return { ok: false, reason: "missing .result object" };
  if (res.id == null) return { ok: false, reason: "missing result.id" };
  if (typeof res.table_name !== "string") return { ok: false, reason: "missing result.table_name" };
  if (!Array.isArray(res.columns)) return { ok: false, reason: "result.columns is not an array" };
  if (!Array.isArray(res.metrics)) return { ok: false, reason: "result.metrics is not an array" };
  return { ok: true };
}

/** Проверка сохранённого файла: перечитать, распарсить, сверить id. */
function verifySavedFile(path: string, datasetId: number): ValidationResult {
  if (!existsSync(path)) return "file_missing";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.result?.id !== datasetId) return "invalid_structure";
    const v = validateStructure(parsed);
    return v.ok ? "valid" : "invalid_structure";
  } catch {
    return "file_corrupt";
  }
}

/** Единая функция получения detail (preview и batch). Использует retry/re-auth клиента. */
async function fetchDetail(client: SupersetClient, datasetId: number): Promise<IdResult & { raw?: any }> {
  try {
    const data = await client.detail("dataset", datasetId);
    return { dataset_id: datasetId, ok: true, http_status: 200, raw: data };
  } catch (e: any) {
    const status = e?.status ?? null;
    let errorClass: "permanent" | "transient" = "transient";
    if (status === 403 || status === 404) errorClass = "permanent";
    // nonRetryable тоже ставится клиентом для 403/404
    if (e?.nonRetryable) errorClass = "permanent";
    return { dataset_id: datasetId, ok: false, http_status: status, error: String(e.message ?? e).slice(0, 400), error_class: errorClass };
  }
}

function summarizeResult(raw: any): Omit<IdResult, "dataset_id" | "ok" | "http_status"> {
  const res = raw?.result ?? {};
  return {
    table_name: res.table_name,
    sql_length: typeof res.sql === "string" ? res.sql.length : 0,
    columns_count: Array.isArray(res.columns) ? res.columns.length : 0,
    metrics_count: Array.isArray(res.metrics) ? res.metrics.length : 0,
    changed_on: res.changed_on,
  };
}

/** Сохранение полного ответа + проверка файла. Возвращает итоговый статус. */
function persistDetail(datasetId: number, raw: any): IdResult {
  const filePath = join(DETAILS_DIR, `${datasetId}.json`);
  atomicWrite(filePath, JSON.stringify({ ...raw, _fetched_at: new Date().toISOString(), _source: `${config.baseUrl}/api/v1/dataset/${datasetId}` }, null, 2));
  const validation = verifySavedFile(filePath, datasetId);
  return {
    dataset_id: datasetId,
    ok: validation === "valid",
    http_status: 200,
    ...summarizeResult(raw),
    file_path: filePath,
    validation,
    fetched_at: new Date().toISOString(),
    ...(validation !== "valid" ? { error: `save validation failed: ${validation}`, error_class: "transient" } : {}),
  };
}

async function main() {
  mkdirSync(DETAILS_DIR, { recursive: true });
  mkdirSync("data", { recursive: true });

  console.log("=== Dataset Detail Loader (v2, ТЗ §3) ===");
  console.log(`API: ${config.baseUrl} | rate limit: ${config.rateLimitMs}ms/request | priority set: ${PRIORITY_IDS.length}`);

  const client = new SupersetClient(config);
  await client.login();
  console.log("[auth] login ok\n");

  const cp = loadCheckpoint();

  // --- Шаг A: восстановить статус completed-checkpoint файлов (ТЗ п.13) ---
  const staleCompleted: number[] = [];
  for (const id of [...cp.completed_ids]) {
    const stored = cp.results[String(id)];
    const path = stored?.file_path ?? join(DETAILS_DIR, `${id}.json`);
    const validation = verifySavedFile(path, id);
    if (validation !== "valid") {
      staleCompleted.push(id);
      cp.completed_ids = cp.completed_ids.filter((x) => x !== id);
      delete cp.results[String(id)];
      console.log(`[recover] #${id}: marked completed but file invalid (${validation}) → will refetch`);
    }
  }
  if (staleCompleted.length) saveCheckpoint(cp);

  // --- Шаг B: определить очередь ---
  // Preview и batch — один и тот же набор: приоритетные ID минус уже completed/failed(permanent).
  const queue = PRIORITY_IDS.filter(
    (id) => !cp.completed_ids.includes(id) && !cp.failed_ids.includes(id)
  );
  console.log(`[plan] completed=${cp.completed_ids.length}, permanent_failed=${cp.failed_ids.length}, to_fetch=${queue.length}\n`);

  const reusedFromDisk: IdResult[] = [];
  for (const id of cp.completed_ids) {
    const r = cp.results[String(id)];
    if (r) reusedFromDisk.push(r);
  }
  if (reusedFromDisk.length) {
    console.log(`[reuse] ${reusedFromDisk.length} results already in checkpoint (from previous runs, incl. preview)`);
  }

  const runResults: IdResult[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    cp.attempts[String(id)] = (cp.attempts[String(id)] ?? 0) + 1;
    console.log(`[${i + 1}/${queue.length}] fetching dataset ${id} (attempt ${cp.attempts[String(id)]})...`);

    const outcome = await fetchDetail(client, id);

    let final: IdResult;
    if (outcome.ok) {
      const v = validateStructure(outcome.raw);
      if (v.ok) {
        final = persistDetail(id, outcome.raw);
      } else {
        final = {
          dataset_id: id, ok: false, http_status: 200,
          error: `structure invalid: ${v.reason}`, error_class: "permanent",
          validation: "invalid_structure",
        };
        cp.failed_ids.push(id);
      }
    } else {
      final = { ...outcome };
      delete (final as any).raw;
      if (outcome.error_class === "permanent") cp.failed_ids.push(id);
      else if (!cp.transient_failures.includes(id)) cp.transient_failures.push(id);
    }

    cp.results[String(id)] = final;
    if (final.ok && !cp.completed_ids.includes(id)) cp.completed_ids.push(id);
    cp.transient_failures = cp.transient_failures.filter((x) => x !== id || !final.ok);
    if (final.ok) cp.total_fetched++;
    cp.last_ts = new Date().toISOString();
    saveCheckpoint(cp); // порядок: счётчики/ts ДО сохранения (ТЗ п.9)

    runResults.push(final);

    const mark = final.ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${id} ${final.table_name ?? ""} status=${final.http_status ?? "-"} sql=${final.sql_length ?? "-"} cols=${final.columns_count ?? "-"} metrics=${final.metrics_count ?? "-"}${final.error ? " err=" + final.error.slice(0, 80) : ""}`
    );

    if (i < queue.length - 1) await sleep(config.rateLimitMs);
  }

  // --- Шаг C: сводный отчёт 12/12 ---
  const all = [...reusedFromDisk, ...runResults].filter((r) => PRIORITY_IDS.includes(r.dataset_id));
  // дедуп по id, свежие поверх старых
  const byId = new Map<number, IdResult>();
  for (const r of all) byId.set(r.dataset_id, r);

  const rows = PRIORITY_IDS.map((id) => {
    const r = byId.get(id);
    return {
      dataset_id: id,
      in_checkpoint: cp.completed_ids.includes(id),
      http_status: r?.http_status ?? null,
      table_name: r?.table_name ?? null,
      sql_length: r?.sql_length ?? null,
      columns_count: r?.columns_count ?? null,
      metrics_count: r?.metrics_count ?? null,
      changed_on: r?.changed_on ?? null,
      file_path: r?.file_path ?? null,
      validation: r?.validation ?? (cp.completed_ids.includes(id) ? "valid" : "not_fetched"),
      error: r?.error ?? null,
    };
  });

  const okCount = rows.filter((r) => r.validation === "valid").length;
  const summary = {
    generated_at: new Date().toISOString(),
    api_base: config.baseUrl,
    method: "SupersetClient.detail() — единая функция для preview/batch; полный ответ сохраняется атомарно",
    rate_limit_ms: config.rateLimitMs,
    totals: {
      priority: PRIORITY_IDS.length,
      valid_details: okCount,
      permanent_failed: cp.failed_ids.length,
      missing: PRIORITY_IDS.length - okCount - cp.failed_ids.length,
    },
    datasets: rows,
    checkpoint_file: CHECKPOINT_FILE,
  };
  atomicWrite(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log("\n=== Summary ===");
  for (const r of rows) {
    console.log(`${r.validation === "valid" ? "✓" : r.validation === "not_fetched" ? "·" : "✗"} ${r.dataset_id} ${r.table_name ?? ""} sql=${r.sql_length} cols=${r.columns_count} metrics=${r.metrics_count} file=${r.file_path ?? "-"} [${r.validation}]`);
  }
  console.log(`\nvalid: ${okCount}/${PRIORITY_IDS.length} | summary: ${SUMMARY_FILE}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
