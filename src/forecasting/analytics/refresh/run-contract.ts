/**
 * Stage 3.3.2 — контракт запуска обновления (extraction run) и идемпотентность.
 *
 * Решение по хранению: контракт запуска сохраняется в ФАЙЛОВОМ манифесте
 * (`data/extraction/superset/stage-3.3/runs/<run_id>.json`), а не в SQLite.
 * Причина: на этом этапе схема БД не расширяется без отдельного согласования (ТЗ 2.4),
 * а raw-артефакты выгрузок уже неизменяемы и хешируются.
 *
 * Сырые артефакты не изменяются: фиксируются только их хеши и метаданные.
 */

import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readRunArtifacts } from "../../ingestion/artifact-reader";
import { calendarRange } from "../profiling/metrics-profile";

export interface RunContract {
  run_id: string;
  started_at: string;
  finished_at: string;
  shop_no: string;
  slice_id: number;
  metric: string;
  requested_from: string;
  requested_to: string;
  timezone: string;
  source_identifier: string;
  request_hash: string | null;
  response_hash: string;
  rows_received: number;
  rows_valid: number;
  rows_rejected: number;
  status: "VALIDATED" | "REJECTED" | "INCOMPLETE";
  completeness: string;
  http_status: number | null;
  interval_label: string;
  run_dir: string;
  file_hashes: Record<string, string>;
  validation: { code: string; passed: boolean; detail: string }[];
  notes: string[];
}

export interface ValidationOutcome {
  status: RunContract["status"];
  checks: RunContract["validation"];
  rowsReceived: number;
  rowsValid: number;
  rowsRejected: number;
  completeness: string;
  httpStatus: number | null;
  requestHash: string | null;
  responseHash: string;
  fileHashes: Record<string, string>;
  firstDate: string | null;
  lastDate: string | null;
}

async function sha256OfFile(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Проверки выгрузки по принципу fail-closed: любой дефект переводит статус в REJECTED/INCOMPLETE. */
export async function validateExtraction(
  runDir: string,
  expected: { shopNo: string; sliceId: number; metric: string },
): Promise<ValidationOutcome> {
  const dir = resolve(runDir);
  const artifacts = await readRunArtifacts(dir);
  const checks: RunContract["validation"] = [];
  const push = (code: string, passed: boolean, detail: string) => checks.push({ code, passed, detail });

  const shopNo = String(artifacts.manifest?.shopno ?? "");
  push("expected_shop_no", shopNo === expected.shopNo, `shop_no=${shopNo}, ожидался ${expected.shopNo}`);

  const sources = Array.isArray(artifacts.manifest?.sources) ? artifacts.manifest.sources : [];
  const sliceIds = sources.map((source: any) => Number(source.slice_id));
  push("expected_slice", sliceIds.includes(expected.sliceId), `срезы выгрузки: ${sliceIds.join(", ") || "—"}; ожидался ${expected.sliceId}`);

  const metrics = [...new Set(artifacts.observations.map((row) => row.metric))];
  push("expected_metric_only", metrics.length === 1 && metrics[0] === expected.metric, `метрики выгрузки: ${metrics.join(", ") || "—"}`);

  const quality = artifacts.quality?.requests?.[0] ?? {};
  const completeness = String(quality.completeness ?? "none");
  const httpStatus = quality.http_status == null ? null : Number(quality.http_status);
  push("http_200", httpStatus === 200, `HTTP ${httpStatus ?? "—"}`);
  push("completeness_full", completeness === "full", `полнота ${completeness}`);
  push("no_missing_metrics", (quality.missing_metrics?.length ?? 0) === 0, `missing_metrics=${quality.missing_metrics?.length ?? 0}`);
  push("no_duplicate_rows", Number(quality.duplicate_rows ?? 0) === 0, `duplicate_rows=${quality.duplicate_rows ?? 0}`);

  const dated = artifacts.observations.filter((row) => row.date !== "");
  const keys = new Set<string>();
  let duplicates = 0;
  for (const row of dated) {
    const key = `${row.date}\u0001${row.slice_id}\u0001${row.metric}`;
    if (keys.has(key)) duplicates++;
    else keys.add(key);
  }
  push("natural_key_unique", duplicates === 0, `дублей natural key: ${duplicates}`);
  push("no_nulls", dated.every((row) => row.value !== null), `NULL: ${dated.filter((row) => row.value === null).length}`);
  push("no_negative", dated.every((row) => (row.value ?? 0) >= 0), `отрицательных: ${dated.filter((row) => (row.value ?? 0) < 0).length}`);
  push("schema_known", dated.every((row) => row.metric_kind === "additive" || row.metric_kind === "ratio"), "metric_kind распознан");

  const dates = dated.map((row) => row.date).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates.at(-1) ?? null;
  if (firstDate && lastDate) {
    const expectedDays = calendarRange(firstDate, lastDate).length;
    push("calendar_continuous", expectedDays === new Set(dates).size, `дней в календаре ${expectedDays}, фактически ${new Set(dates).size}`);
  }

  const requestFile = (await readdir(dir)).find((file) => file.endsWith(".request.json"));
  const responseFile = (await readdir(dir)).find((file) => file.endsWith(".response.json"));
  const fileHashes: Record<string, string> = {
    "manifest.json": await sha256OfFile(join(dir, "manifest.json")),
    "observations_7745.csv": await sha256OfFile(join(dir, "observations_7745.csv")),
  };
  if (requestFile) fileHashes[requestFile] = await sha256OfFile(join(dir, requestFile));
  if (responseFile) fileHashes[responseFile] = await sha256OfFile(join(dir, responseFile));

  const requestHash = sources[0]?.request_sha256 ? String(sources[0].request_sha256) : null;
  const responseHash = fileHashes[responseFile ?? "observations_7745.csv"]!;

  const failed = checks.filter((check) => !check.passed);
  const status: RunContract["status"] = failed.some((check) => ["expected_shop_no", "expected_slice", "expected_metric_only", "http_200", "schema_known"].includes(check.code))
    ? "REJECTED"
    : failed.length
      ? "INCOMPLETE"
      : "VALIDATED";

  return {
    status,
    checks,
    rowsReceived: artifacts.observations.length,
    rowsValid: dated.length,
    rowsRejected: artifacts.observations.length - dated.length,
    completeness,
    httpStatus,
    requestHash,
    responseHash,
    fileHashes,
    firstDate,
    lastDate,
  };
}

/** Идентификатор запуска детерминирован: интервал + хеш ответа + диапазон дат. */
export function runIdFor(intervalLabel: string, responseHash: string, from: string, to: string): string {
  return `${intervalLabel}-${responseHash.slice(0, 12)}-${from}_${to}`;
}

export interface CaptureResult {
  run: RunContract;
  created: boolean;
  path: string;
}

/** Фиксирует контракт запуска. Повторный вызов с теми же артефактами не создаёт новый запуск. */
export async function captureRun(input: {
  runDir: string;
  intervalLabel: string;
  shopNo: string;
  sliceId: number;
  metric: string;
  timezone: string;
  runsDir: string;
  startedAt: string;
  finishedAt: string;
  dryRun?: boolean;
}): Promise<CaptureResult> {
  const outcome = await validateExtraction(input.runDir, { shopNo: input.shopNo, sliceId: input.sliceId, metric: input.metric });
  const from = outcome.firstDate ?? "";
  const to = outcome.lastDate ?? "";
  const runId = runIdFor(input.intervalLabel, outcome.responseHash, from, to);
  const runsDir = resolve(input.runsDir);
  const path = join(runsDir, `${runId}.json`);

  await mkdir(runsDir, { recursive: true });
  const existing = await Bun.file(path).exists();
  const run: RunContract = {
    run_id: runId,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    shop_no: input.shopNo,
    slice_id: input.sliceId,
    metric: input.metric,
    requested_from: from,
    requested_to: to,
    timezone: input.timezone,
    source_identifier: `daily_metrics#slice=${input.sliceId}&metric=${input.metric}&interval=${input.intervalLabel}`,
    request_hash: outcome.requestHash,
    response_hash: outcome.responseHash,
    rows_received: outcome.rowsReceived,
    rows_valid: outcome.rowsValid,
    rows_rejected: outcome.rowsRejected,
    status: outcome.status,
    completeness: outcome.completeness,
    http_status: outcome.httpStatus,
    interval_label: input.intervalLabel,
    run_dir: resolve(input.runDir),
    file_hashes: outcome.fileHashes,
    validation: outcome.checks,
    notes: [
      "raw-артефакты не изменялись: зафиксированы только хеши",
      existing ? "запуск уже зафиксирован: повторная запись не выполнялась (идемпотентность)" : "запуск зафиксирован впервые",
    ],
  };

  if (!existing && !input.dryRun) await Bun.write(path, `${JSON.stringify(run, null, 2)}\n`);
  return { run, created: !existing && !input.dryRun, path };
}

export async function listRuns(runsDir: string): Promise<RunContract[]> {
  const dir = resolve(runsDir);
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const runs: RunContract[] = [];
    for (const file of files) runs.push(JSON.parse(await readFile(join(dir, file), "utf8")));
    return runs;
  } catch {
    return [];
  }
}

export async function latestRun(runsDir: string): Promise<RunContract | null> {
  const runs = await listRuns(runsDir);
  return runs.at(-1) ?? null;
}

/** Проверка, что старый запуск не переиспользуется с другим содержимым. */
export function assertRunIdentity(run: RunContract, responseHash: string): void {
  if (run.response_hash !== responseHash) {
    throw new Error(`run_id ${run.run_id} уже связан с другим ответом источника: ${run.response_hash} ≠ ${responseHash}`);
  }
}
