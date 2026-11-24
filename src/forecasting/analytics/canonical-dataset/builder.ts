/**
 * Stage 3.2.3 — построение канонического дневного набора.
 *
 * Функция чистая: получает уже прочитанные строки среза и не обращается к SQLite,
 * поэтому её поведение детерминировано и проверяемо тестами.
 *
 * Жёсткие правила:
 *  - используется ровно один slice_id;
 *  - строки без даты (итоги за период) в дневной ряд не попадают;
 *  - несколько строк на одну дату НЕ суммируются автоматически (это ошибка инварианта);
 *  - NULL не заменяется нулём, отрицательные значения фиксируются как ошибка;
 *  - дробные значения сохраняются как есть и понижают статус качества до conditional.
 */

import type { CanonicalDataset, CanonicalDailyObservation, SliceSourceRow, ValidationIssue } from "./types";

export interface BuildInput {
  shopNo: string;
  metric: string;
  businessName: string;
  sourceSliceId: number;
  /** Включительно. */
  from: string;
  /** Исключающая верхняя граница (как в исходных данных Superset). */
  to: string;
  generatedAt: string;
}

export interface BuildResult {
  dataset: CanonicalDataset;
  issues: ValidationIssue[];
}

function checksumOf(observations: readonly CanonicalDailyObservation[]): string {
  const payload = observations.map((observation) => `${observation.date}\t${observation.value}`).join("\n");
  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
}

export function buildCanonicalDailyDataset(rows: readonly SliceSourceRow[], input: BuildInput): BuildResult {
  const issues: ValidationIssue[] = [];
  const sliceRows = rows.filter((row) => row.sliceId === input.sourceSliceId);
  const totalsRows = sliceRows.filter((row) => row.date === "");
  const inWindow = sliceRows.filter((row) => row.date !== "" && row.date >= input.from && row.date < input.to);

  const byDate = new Map<string, SliceSourceRow[]>();
  for (const row of inWindow) {
    const bucket = byDate.get(row.date) ?? [];
    bucket.push(row);
    byDate.set(row.date, bucket);
  }

  const observations: CanonicalDailyObservation[] = [];
  let rejectedRows = 0;
  const datasetQuality: Array<"full" | "conditional" | "blocked"> = [];

  for (const [date, dateRows] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (dateRows.length !== 1) {
      issues.push({
        severity: "error",
        code: "multiple_rows_per_date",
        message: `${date}: ${dateRows.length} строк в срезе ${input.sourceSliceId} — суммирование измерений не подтверждено, набор не строится`,
      });
      rejectedRows += dateRows.length;
      datasetQuality.push("blocked");
      continue;
    }

    const row = dateRows[0]!;
    if (row.value === null) {
      issues.push({ severity: "error", code: "null_value", message: `${date}: значение NULL — нулём не заменяется` });
      rejectedRows++;
      datasetQuality.push("blocked");
      continue;
    }
    if (row.value < 0) {
      issues.push({ severity: "error", code: "negative_value", message: `${date}: отрицательное значение ${row.value}` });
      datasetQuality.push("blocked");
    }
    if (!Number.isInteger(row.value)) {
      issues.push({
        severity: "warning",
        code: "fractional_value",
        message: `${date}: дробное значение ${row.value} — сохранено как есть, требуется объяснение источника`,
      });
      datasetQuality.push("conditional");
    }
    if (row.runId === null) {
      issues.push({ severity: "warning", code: "missing_run_id", message: `${date}: не восстановлен extraction run_id` });
      datasetQuality.push("conditional");
    }

    observations.push({
      date,
      shopNo: input.shopNo,
      metric: input.metric,
      businessName: input.businessName,
      value: row.value,
      sourceSliceId: row.sliceId,
      sourceDatasetId: row.datasetId,
      sourceRunId: row.runId === null ? null : String(row.runId),
      qualityStatus: "full",
    });
  }

  const quality: "full" | "conditional" | "blocked" = datasetQuality.includes("blocked")
    ? "blocked"
    : datasetQuality.includes("conditional")
      ? "conditional"
      : "full";
  for (const observation of observations) observation.qualityStatus = quality;

  if (totalsRows.length > 0) {
    issues.push({
      severity: "info",
      code: "excluded_totals",
      message: `${totalsRows.length} строк без даты (итоги за период) исключены из дневного ряда`,
    });
  }

  const dates = observations.map((observation) => observation.date);
  const dataset: CanonicalDataset = {
    shopNo: input.shopNo,
    metric: input.metric,
    businessName: input.businessName,
    sourceSliceId: input.sourceSliceId,
    period: { from: dates[0] ?? input.from, to: dates.at(-1) ?? "", days: dates.length },
    observations,
    provenance: {
      sourceFile: `daily_metrics#slice=${input.sourceSliceId}&metric=${input.metric}`,
      extractionRunIds: [...new Set(inWindow.map((row) => row.runId).filter((id): id is number => id !== null))].sort((a, b) => a - b),
      extractionRunNotes: [],
      transformVersions: [...new Set(inWindow.map((row) => row.transformVersion))].sort(),
      sourceSliceId: input.sourceSliceId,
      sourceDatasetId: inWindow.find((row) => row.datasetId !== null)?.datasetId ?? null,
      evidenceStatuses: [...new Set(inWindow.map((row) => row.evidenceStatus))].sort(),
      dataStatuses: [...new Set(inWindow.map((row) => row.dataStatus))].sort(),
      generatedAt: input.generatedAt,
      checksum: checksumOf(observations),
    },
    totalDelivered: observations.reduce((acc, observation) => acc + observation.value, 0),
    excludedTotalsRows: totalsRows.length,
  };

  if (rejectedRows > 0) {
    issues.push({
      severity: "error",
      code: "rejected_rows",
      message: `отклонено строк: ${rejectedRows} — канонический набор неполон`,
    });
  }

  return { dataset, issues };
}
