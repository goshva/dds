/**
 * Импорт одной выгрузки в SQLite: запуск → сырые артефакты → наблюдения.
 * Повторный импорт того же набора идемпотентен: natural key не содержит run_id.
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { redactText } from "../../../tools/redact-pii";
import type { DailyMetricRow } from "../storage/interfaces/types";
import type { ForecastingStore } from "../storage/sqlite/store";
import { readRunArtifacts, type ArtifactRow, type RunArtifacts } from "./artifact-reader";
import type { ImportOptions, ImportSummary } from "./types";
import { sliceStatusFromQuality, validateArtifacts, type SliceQualityStatus } from "./validation";

/** Единицы измерения, подтверждённые аудитом. Деньги НЕ подтверждены — unit остаётся NULL. */
function unitOf(metric: string, metricKind: string): string | null {
  if (metric.startsWith("qty_")) return "count";
  if (metric.startsWith("share_")) return "share";
  if (metric.startsWith("sum_")) return null; // валюта не подтверждена: не выбираем рубли или копейки
  if (metricKind === "ratio") return "share";
  return null;
}

/**
 * Статусы срезов считает ТА ЖЕ функция, что и валидатор ({@link sliceStatusFromQuality}):
 * срез с дефектами качества не может получить full/actual ни при проверке, ни при импорте.
 */
function sliceStatuses(artifacts: RunArtifacts): Map<number, SliceQualityStatus> {
  const map = new Map<number, SliceQualityStatus>();
  for (const request of artifacts.quality?.requests ?? []) {
    const status = sliceStatusFromQuality(request);
    if (Number.isFinite(status.slice_id)) map.set(status.slice_id, status);
  }
  return map;
}

/** Срез без записи в quality.json: данных нет, достоверность неизвестна. */
function unknownSliceStatus(sliceId: number): SliceQualityStatus {
  return {
    slice_id: sliceId,
    data_status: "none",
    evidence_status: "unknown",
    importable_as_full: false,
    reasons: ["нет записи в quality.json"],
  };
}

interface RowContext {
  shopNo: string;
  runId: number;
  sourceFile: string;
  requestSha: string;
  statuses: SliceQualityStatus;
  transformVersion: string;
  loadedAt: string;
}

function toDailyMetricRow(row: ArtifactRow, options: RowContext): DailyMetricRow {
  const valueMissing = row.value === null;
  // Измерения маскируются и при импорте: аналитические строки не должны содержать ПДн,
  // а маскированное и «сырое» представления одного наблюдения не должны размножаться в две строки.
  const dimension1 = redactText(row.dimension_1).text;
  const dimension2 = redactText(row.dimension_2).text;
  return {
    shop_no: options.shopNo,
    date: row.date,
    slice_id: row.slice_id,
    chart_id: row.slice_id,
    dataset_id: row.dataset_id,
    dimension_1: dimension1,
    dimension_2: dimension2,
    metric: row.metric,
    metric_kind: row.metric_kind === "ratio" ? "ratio" : "additive",
    value: row.value,
    unit: unitOf(row.metric, row.metric_kind),
    // отсутствующее значение не становится нулём: достоверность понижается до unknown
    evidence_status: valueMissing ? "unknown" : options.statuses.evidence_status,
    data_status: options.statuses.data_status,
    run_id: options.runId,
    source_file: options.sourceFile,
    request_sha256: options.requestSha,
    transform_version: options.transformVersion,
    loaded_at: options.loadedAt,
  };
}

export interface ImportDependencies {
  store: ForecastingStore;
  now?: () => Date;
}

/** Импортирует каталог выгрузки. Возвращает сводку; при ошибках валидации бросает исключение. */
export async function importRun(
  deps: ImportDependencies,
  options: ImportOptions,
): Promise<ImportSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const loadedAt = now.toISOString();
  const artifacts = await readRunArtifacts(options.runDir);

  // валидатор получает те же инварианты natural key, с которыми будет выполнена запись
  const validation = validateArtifacts(artifacts, {
    transformVersion: options.transformVersion,
    expectedShopNo: options.shopNo,
  });
  if (!validation.ok) {
    const errors = validation.findings.filter((f) => f.severity === "error").map((f) => f.message);
    throw new Error(`импорт отклонён проверками: ${errors.join("; ")}`);
  }

  const shopNo = String(artifacts.manifest.shopno ?? "");
  if (!shopNo) throw new Error("в манифесте не указан shopno");

  const period = {
    from: String(artifacts.manifest.period?.from ?? ""),
    to: String(artifacts.manifest.period?.to ?? ""),
  };
  const manifestPayload = await readFile(join(artifacts.dir, "manifest.json"), "utf8");
  const qualityPayload = await readFile(join(artifacts.dir, "quality.json"), "utf8");
  const observationsPayload = await readFile(join(artifacts.dir, "observations_7745.csv"), "utf8");
  const aggregatePayload = artifacts.aggregate.length
    ? await readFile(join(artifacts.dir, "aggregate_7745.csv"), "utf8")
    : null;

  // даркстор должен существовать (внешний ключ)
  deps.store.db
    .query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?) ON CONFLICT(shop_no) DO NOTHING")
    .run(shopNo, shopNo, loadedAt);

  const runId = deps.store.raw.createRun({
    started_at: loadedAt,
    mode: options.mode ?? "import-artifacts",
    shop_no: shopNo,
    period_from: period.from,
    period_to: period.to,
    tool_version: `forecasting-ingest/${options.transformVersion}`,
    manifest_path: options.runDir,
    manifest_sha256: new Bun.CryptoHasher("sha256").update(manifestPayload).digest("hex"),
    notes: `source=${options.sourceLabel}`,
  });

  let rawNew = 0;
  let rawDuplicate = 0;
  const storeRaw = (source_kind: string, source_ref: string, payload: string) => {
    const result = deps.store.raw.addExtraction({ run_id: runId, source_kind, source_ref, payload, loaded_at: loadedAt });
    if (result.duplicate) rawDuplicate++;
    else rawNew++;
  };
  storeRaw("manifest", basename(options.runDir), manifestPayload);
  storeRaw("quality", basename(options.runDir), qualityPayload);
  storeRaw("observations_csv", "observations_7745.csv", observationsPayload);
  if (aggregatePayload) storeRaw("aggregate_csv", "aggregate_7745.csv", aggregatePayload);

  const statuses = sliceStatuses(artifacts);
  const requestShaBySlice = new Map<number, string>();
  for (const source of artifacts.manifest.sources ?? []) {
    requestShaBySlice.set(Number(source.slice_id), String(source.request_sha256 ?? ""));
  }

  const rows: DailyMetricRow[] = [];
  let skipped = 0;
  for (const artifact of artifacts.observations) {
    if (!artifact.date) {
      // итоги за период хранятся отдельно от дневных наблюдений
      skipped++;
      continue;
    }
    const statusesForSlice = statuses.get(artifact.slice_id) ?? unknownSliceStatus(artifact.slice_id);
    rows.push(
      toDailyMetricRow(artifact, {
        shopNo,
        runId,
        sourceFile: `observations_7745.csv#slice=${artifact.slice_id}`,
        requestSha: requestShaBySlice.get(artifact.slice_id) ?? "",
        statuses: statusesForSlice,
        transformVersion: options.transformVersion,
        loadedAt,
      }),
    );
  }

  const upsert = deps.store.metrics.upsertDailyMetrics(rows);

  const counts = artifacts.manifest.completeness?.counts ?? {};
  const qualityStatus =
    (counts.none ?? 0) > 0 ? "none" : (counts.truncated ?? 0) > 0 ? "truncated" : (counts.partial ?? 0) > 0 ? "partial" : "full";

  deps.store.raw.finishRun(runId, {
    finished_at: new Date().toISOString(),
    rows_raw: artifacts.observations.length,
    rows_loaded: rows.length,
    quality_status: qualityStatus as never,
    status: "completed",
    notes: `source=${options.sourceLabel}; transform=${options.transformVersion}; skipped_without_date=${skipped}`,
  });

  return {
    run_id: runId,
    source_label: options.sourceLabel,
    transform_version: options.transformVersion,
    period_from: period.from,
    period_to: period.to,
    quality_status: qualityStatus,
    observations_read: artifacts.observations.length,
    inserted: upsert.inserted,
    updated: upsert.updated,
    raw_payloads_new: rawNew,
    raw_payloads_duplicate: rawDuplicate,
    slices: validation.slices_with_rows,
    skipped_rows: skipped,
  };
}
