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
 *  - если файл валиден, но results[id] отсутствует — summary восстанавливается из файла;
 *  - сетевые/преходящие ошибки НЕ попадают в перманентный failed_ids;
 *  - 401 — re-auth (один повтор запроса) через SupersetClient; 429/5xx/network — backoff; 403/404 — финальная ошибка;
 *  - последовательно, 1 запрос/сек (RATE_LIMIT_MS).
 */
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

const config = loadConfig();
const DETAILS_DIR = "output/dataset_details";
const CHECKPOINT_FILE = "data/checkpoint_dataset_detail.json";
const SUMMARY_FILE = "output/dataset_detail_summary.json";

// Приоритетные ID без изменений (ТЗ раздел 3)
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

type ValidationResult =
  | "valid"
  | "invalid_structure"
  | "file_missing"
  | "file_corrupt"
  | "save_failed";

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
  save_error?: boolean;
};

type Checkpoint = {
  completed_ids: number[];
  failed_ids: number[];          // только PERMANENT failures (403/404/структура)
  transient_failures: number[];  // сеть/5xx — будут повторены на следующем запуске
  attempts: Record<string, number>;
  results: Record<string, IdResult>;
  successful_fetch_attempts: number;
  total_fetched?: number;        // legacy-поле старых checkpoint
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
      successful_fetch_attempts: cp.successful_fetch_attempts ?? cp.total_fetched ?? 0,
      last_ts: cp.last_ts ?? "",
    };
  } catch {
    return {
      completed_ids: [],
      failed_ids: [],
      transient_failures: [],
      attempts: {},
      results: {},
      successful_fetch_attempts: 0,
      last_ts: "",
    };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  atomicWrite(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

/** Атомарная запись: temp-файл + rename; temp удаляется при ошибке. */
function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function addUnique(list: number[], id: number) {
  if (!list.includes(id)) list.push(id);
}

function removeId(list: number[], id: number) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
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

type SavedFile = { validation: ValidationResult; parsed?: any; reason?: string };

/** Перечитать сохранённый файл и проверить id + структуру. */
function readSavedFile(path: string, datasetId: number): SavedFile {
  if (!existsSync(path)) return { validation: "file_missing" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (String(parsed?.result?.id) !== String(datasetId)) {
      return { validation: "invalid_structure", reason: "saved id mismatch" };
    }
    const v = validateStructure(parsed);
    if (!v.ok) return { validation: "invalid_structure", reason: v.reason };
    return { validation: "valid", parsed };
  } catch {
    return { validation: "file_corrupt" };
  }
}

function verifySavedFile(path: string, datasetId: number): ValidationResult {
  return readSavedFile(path, datasetId).validation;
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
    if (e?.nonRetryable) errorClass = "permanent";
    return {
      dataset_id: datasetId,
      ok: false,
      http_status: status,
      error: String(e?.message ?? e).slice(0, 400),
      error_class: errorClass,
    };
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

/** Восстановить summary из валидного файла (checkpoint без results[id]). */
function restoreResultFromFile(datasetId: number, path: string): IdResult | null {
  const saved = readSavedFile(path, datasetId);
  if (saved.validation !== "valid" || !saved.parsed) return null;
  return {
    dataset_id: datasetId,
    ok: true,
    http_status: 200,
    ...summarizeResult(saved.parsed),
    file_path: path,
    validation: "valid",
    fetched_at: saved.parsed?._fetched_at ?? new Date().toISOString(),
  };
}

/** Сохранение полного ответа + проверка файла. Возвращает итоговый статус. */
function persistDetail(datasetId: number, raw: any): IdResult {
  const filePath = join(DETAILS_DIR, `${datasetId}.json`);
  atomicWrite(
    filePath,
    JSON.stringify(
      {
        ...raw,
        _fetched_at: new Date().toISOString(),
        _source: `${config.baseUrl}/api/v1/dataset/${datasetId}`,
      },
      null,
      2,
    ),
  );
  const validation = verifySavedFile(filePath, datasetId);
  return {
    dataset_id: datasetId,
    ok: validation === "valid",
    http_status: 200,
    ...summarizeResult(raw),
    file_path: filePath,
    validation,
    fetched_at: new Date().toISOString(),
    ...(validation !== "valid"
      ? { error: `save validation failed: ${validation}`, error_class: "transient" as const }
      : {}),
  };
}

/** Ошибки записи, которые означают повреждение общей инфраструктуры. */
function isFatalSaveError(error: any): boolean {
  const code = String(error?.code ?? "");
  return ["ENOSPC", "EROFS", "EACCES", "EPERM", "EMFILE", "ENFILE"].includes(code);
}

async function main() {
  mkdirSync(DETAILS_DIR, { recursive: true });
  mkdirSync("data", { recursive: true });

  console.log("=== Dataset Detail Loader (v2, ТЗ §3) ===");
  console.log(
    `API: ${config.baseUrl} | rate limit: ${config.rateLimitMs}ms/request | priority set: ${PRIORITY_IDS.length}`,
  );

  const client = new SupersetClient(config);
  let loggedIn = false;
  const ensureLogin = async () => {
    if (loggedIn) return;
    await client.login();
    loggedIn = true;
    console.log("[auth] login ok\n");
  };

  const cp = loadCheckpoint();

  // --- Шаг A: восстановить статус completed-checkpoint файлов ---
  const staleCompleted: number[] = [];
  for (const id of [...cp.completed_ids]) {
    const stored = cp.results[String(id)];
    const path = stored?.file_path ?? join(DETAILS_DIR, `${id}.json`);
    const saved = readSavedFile(path, id);
    if (saved.validation !== "valid") {
      staleCompleted.push(id);
      cp.completed_ids = cp.completed_ids.filter((x) => x !== id);
      delete cp.results[String(id)];
      console.log(`[recover] #${id}: marked completed but file invalid (${saved.validation}) → will refetch`);
      continue;
    }

    // Файл валиден, но summary в checkpoint отсутствует/неполный → восстановить из JSON.
    const needsRestore =
      !stored ||
      stored.validation !== "valid" ||
      !stored.table_name ||
      !stored.file_path;
    if (needsRestore) {
      const restored = restoreResultFromFile(id, path);
      if (restored) {
        cp.results[String(id)] = restored;
        console.log(`[recover] #${id}: summary restored from ${path} (${restored.table_name})`);
      }
    }
  }
  if (staleCompleted.length || cp.completed_ids.length) saveCheckpoint(cp);

  // --- Шаг B: определить очередь ---
  const queue = PRIORITY_IDS.filter(
    (id) => !cp.completed_ids.includes(id) && !cp.failed_ids.includes(id),
  );
  console.log(
    `[plan] completed=${cp.completed_ids.length}, permanent_failed=${cp.failed_ids.length}, to_fetch=${queue.length}\n`,
  );

  const reusedFromDisk: IdResult[] = [];
  for (const id of cp.completed_ids) {
    const r = cp.results[String(id)];
    if (r) reusedFromDisk.push(r);
  }
  if (reusedFromDisk.length) {
    console.log(`[reuse] ${reusedFromDisk.length} results already in checkpoint (incl. restored from disk)`);
  }

  const runResults: IdResult[] = [];
  if (queue.length > 0) await ensureLogin();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    cp.attempts[String(id)] = (cp.attempts[String(id)] ?? 0) + 1;
    console.log(`[${i + 1}/${queue.length}] fetching dataset ${id} (attempt ${cp.attempts[String(id)]})...`);

    const outcome = await fetchDetail(client, id);

    let final: IdResult;
    if (outcome.ok) {
      const v = validateStructure(outcome.raw);
      if (v.ok) {
        try {
          final = persistDetail(id, outcome.raw);
        } catch (error: any) {
          if (isFatalSaveError(error)) throw error;
          final = {
            dataset_id: id,
            ok: false,
            http_status: 200,
            error: `save failed: ${String(error?.message ?? error)}`.slice(0, 400),
            error_class: "transient",
            validation: "save_failed",
            save_error: true,
          };
          addUnique(cp.transient_failures, id);
          removeId(cp.failed_ids, id);
        }
      } else {
        final = {
          dataset_id: id,
          ok: false,
          http_status: 200,
          error: `structure invalid: ${v.reason}`,
          error_class: "permanent",
          validation: "invalid_structure",
        };
        addUnique(cp.failed_ids, id);
        removeId(cp.transient_failures, id);
      }
    } else {
      final = { ...outcome };
      delete (final as any).raw;
      if (outcome.error_class === "permanent") {
        addUnique(cp.failed_ids, id);
        removeId(cp.transient_failures, id);
      } else {
        addUnique(cp.transient_failures, id);
        removeId(cp.failed_ids, id);
      }
    }

    cp.results[String(id)] = final;
    if (final.ok && !cp.completed_ids.includes(id)) cp.completed_ids.push(id);
    if (final.ok) {
      removeId(cp.failed_ids, id);
      removeId(cp.transient_failures, id);
    }
    cp.transient_failures = cp.transient_failures.filter((x) => x !== id || !final.ok);
    if (final.ok) cp.successful_fetch_attempts++;
    cp.last_ts = new Date().toISOString();
    saveCheckpoint(cp);

    runResults.push(final);

    const mark = final.ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${id} ${final.table_name ?? ""} status=${final.http_status ?? "-"} ` +
      `sql=${final.sql_length ?? "-"} cols=${final.columns_count ?? "-"} metrics=${final.metrics_count ?? "-"}` +
      `${final.error ? " err=" + final.error.slice(0, 80) : ""}`,
    );

    if (i < queue.length - 1) await sleep(config.rateLimitMs);
  }

  // --- Шаг C: сводный отчёт 12/12 ---
  const all = [...reusedFromDisk, ...runResults].filter((r) => PRIORITY_IDS.includes(r.dataset_id));
  const byId = new Map<number, IdResult>();
  for (const r of all) byId.set(r.dataset_id, r);

  const rows = PRIORITY_IDS.map((id) => {
    let r = byId.get(id);
    if (!r) {
      const path = join(DETAILS_DIR, `${id}.json`);
      r = restoreResultFromFile(id, path) ?? undefined;
    }
    const inCheckpoint = cp.completed_ids.includes(id);
    return {
      dataset_id: id,
      in_checkpoint: inCheckpoint,
      http_status: r?.http_status ?? null,
      table_name: r?.table_name ?? null,
      sql_length: r?.sql_length ?? null,
      columns_count: r?.columns_count ?? null,
      metrics_count: r?.metrics_count ?? null,
      changed_on: r?.changed_on ?? null,
      file_path: r?.file_path ?? null,
      validation: r?.validation ?? (inCheckpoint ? "valid" : "not_fetched"),
      error: r?.error ?? null,
      error_class: r?.error_class ?? null,
      save_error: r?.save_error ?? false,
    };
  });

  const okCount = rows.filter((r) => r.validation === "valid").length;
  const permanentFailed = cp.failed_ids.filter((id) => PRIORITY_IDS.includes(id)).length;
  const transientFailed = cp.transient_failures.filter((id) => PRIORITY_IDS.includes(id)).length;
  const uniqueSaved = cp.completed_ids.filter((id) => PRIORITY_IDS.includes(id)).length;

  const verification = PRIORITY_IDS.map((id) => {
    const path = join(DETAILS_DIR, `${id}.json`);
    return { dataset_id: id, file_path: path, validation: verifySavedFile(path, id) };
  });
  const invalidFiles = verification.filter((v) => v.validation !== "valid");

  const summary = {
    generated_at: new Date().toISOString(),
    api_base: config.baseUrl,
    method: "SupersetClient.detail() — единая функция для preview/batch; полный ответ сохраняется атомарно",
    rate_limit_ms: config.rateLimitMs,
    totals: {
      priority: PRIORITY_IDS.length,
      valid_details: okCount,
      unique_saved_datasets: uniqueSaved,
      successful_fetch_attempts: cp.successful_fetch_attempts,
      permanent_failed: permanentFailed,
      transient_failed: transientFailed,
      missing: Math.max(0, PRIORITY_IDS.length - okCount - permanentFailed - transientFailed),
    },
    verification: {
      checked: verification.length,
      all_valid: invalidFiles.length === 0,
      invalid: invalidFiles,
    },
    datasets: rows,
    checkpoint_file: CHECKPOINT_FILE,
  };
  atomicWrite(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log("\n=== Summary ===");
  for (const r of rows) {
    console.log(
      `${r.validation === "valid" ? "✓" : r.validation === "not_fetched" ? "·" : "✗"} ` +
      `${r.dataset_id} ${r.table_name ?? ""} sql=${r.sql_length ?? "-"} cols=${r.columns_count ?? "-"} ` +
      `metrics=${r.metrics_count ?? "-"} file=${r.file_path ?? "-"} [${r.validation}]`,
    );
  }
  console.log(
    `\nvalid: ${okCount}/${PRIORITY_IDS.length} | unique_saved=${uniqueSaved} | ` +
    `successful_fetch_attempts=${cp.successful_fetch_attempts} | ` +
    `permanent_failed=${permanentFailed} | transient_failed=${transientFailed} | summary: ${SUMMARY_FILE}`,
  );

  if (invalidFiles.length > 0 || okCount < PRIORITY_IDS.length) {
    process.exitCode = 1;
    console.error(
      `\n[FAIL] detail files invalid or missing: ${invalidFiles.length} file(s); valid=${okCount}/${PRIORITY_IDS.length}`,
    );
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
