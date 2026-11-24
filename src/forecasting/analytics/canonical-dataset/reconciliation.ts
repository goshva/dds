/**
 * Stage 3.2.4 — сверка канонического набора с исходным срезом.
 *
 * Проверяется, что канонический ряд:
 *  - не потерял строки и не задвоил значения;
 *  - совпадает с дневными суммами выбранного среза по каждой дате;
 *  - совпадает по общей сумме;
 *  - согласуется с остальными четырьмя срезами (только как контроль, без сложения);
 *  - воспроизводим при повторном построении.
 *
 * Статус PASS присваивается только при отсутствии необъяснённых расхождений.
 */

import type {
  CanonicalDataset,
  CrossSliceRow,
  ReconciliationResult,
  ReconciliationRow,
  SliceCandidateStats,
  SliceSourceRow,
  ValidationIssue,
} from "./types";

export interface ReconcileInput {
  dataset: CanonicalDataset;
  /** Все строки метрики по всем срезам (для контрольной сверки). */
  rows: readonly SliceSourceRow[];
  candidates: readonly SliceCandidateStats[];
  crossSlice: readonly CrossSliceRow[];
  expected?: {
    from?: string;
    toInclusive?: string;
    days?: number;
    /** Контрольная сумма из отчёта Stage 3.1 — передаётся извне, не является бизнес-константой кода. */
    total?: number;
  };
  determinism: { runs: number; identical: boolean };
}

export function reconcileDataset(input: ReconcileInput): ReconciliationResult {
  const { dataset, rows, candidates, crossSlice, expected, determinism } = input;
  const issues: ValidationIssue[] = [];
  const checks: ReconciliationResult["checks"] = [];
  const push = (code: string, passed: boolean, detail: string, severity: ValidationIssue["severity"] = "error") => {
    checks.push({ code, passed, detail });
    if (!passed) issues.push({ severity, code, message: detail });
  };

  const sliceRows = rows.filter((row) => row.sliceId === dataset.sourceSliceId);
  const sliceDaily = sliceRows.filter((row) => row.date !== "");
  const sliceTotals = sliceRows.filter((row) => row.date === "");
  const otherSlices = [...new Set(rows.map((row) => row.sliceId))].filter((slice) => slice !== dataset.sourceSliceId).sort((a, b) => a - b);

  // A. количества
  const sourceDailyByDate = new Map<string, { total: number; count: number }>();
  for (const row of sliceDaily) {
    if (row.value === null) continue;
    const bucket = sourceDailyByDate.get(row.date) ?? { total: 0, count: 0 };
    bucket.total += row.value;
    bucket.count++;
    sourceDailyByDate.set(row.date, bucket);
  }

  const crossSliceByDate = new Map(crossSlice.map((row) => [row.date, row]));

  // B. построчная сверка
  const reconciliationRows: ReconciliationRow[] = dataset.observations.map((observation) => {
    const source = sourceDailyByDate.get(observation.date) ?? { total: 0, count: 0 };
    const cross = crossSliceByDate.get(observation.date);
    const deviation = source.total - observation.value;
    return {
      date: observation.date,
      sourceDailyTotal: source.count > 0 ? source.total : null,
      sourceRows: source.count,
      canonicalValue: observation.value,
      deviation,
      equal: deviation === 0,
      crossSliceTotals: cross?.totalsBySlice ?? {},
      crossSliceEqual: cross?.allEqual ?? false,
    };
  });

  const valueMismatches = reconciliationRows.filter((row) => !row.equal);
  push(
    "daily_values_match_source",
    valueMismatches.length === 0,
    valueMismatches.length
      ? `расхождения по ${valueMismatches.length} датам (например, ${valueMismatches[0]!.date}: источник ${valueMismatches[0]!.sourceDailyTotal}, канон ${valueMismatches[0]!.canonicalValue})`
      : `все ${reconciliationRows.length} дневных значений совпадают с исходным срезом ${dataset.sourceSliceId}`,
  );

  // C. период
  const periodMatches =
    (!expected?.from || dataset.period.from === expected.from) &&
    (!expected?.toInclusive || dataset.period.to === expected.toInclusive) &&
    (expected?.days === undefined || dataset.period.days === expected.days);
  push(
    "period_matches_expected",
    periodMatches,
    `фактический период: ${dataset.period.from} … ${dataset.period.to} (${dataset.period.days} дней); ожидаемый: ${expected?.from ?? "—"} … ${expected?.toInclusive ?? "—"} (${expected?.days ?? "—"} дней)`,
  );

  // D. общая сумма
  const sourceTotal = sliceDaily.reduce((acc, row) => acc + (row.value ?? 0), 0);
  const totalsEqual = sourceTotal === dataset.totalDelivered;
  push(
    "totals_match_source",
    totalsEqual,
    `сумма исходного среза ${dataset.sourceSliceId}: ${sourceTotal}; сумма канонического ряда: ${dataset.totalDelivered}`,
  );
  const matchesExpected = expected?.total === undefined ? null : dataset.totalDelivered === expected.total;
  push(
    "total_matches_control_value",
    matchesExpected !== false,
    expected?.total === undefined
      ? "контрольная сумма Stage 3.1 не задана — проверка не выполнялась"
      : `каноническая сумма ${dataset.totalDelivered} против контрольной ${expected.total}`,
    matchesExpected === false ? "error" : "info",
  );

  // E. межсрезовая сверка
  const crossMismatches = crossSlice.filter((row) => !row.allEqual);
  push(
    "cross_slice_agreement",
    crossMismatches.length === 0,
    crossMismatches.length
      ? `дневные суммы срезов расходятся на ${crossMismatches.length} датах`
      : `дневные суммы всех ${candidates.length} срезов совпадают на всех ${crossSlice.length} датах`,
  );
  push(
    "no_other_slice_rows_in_dataset",
    dataset.observations.every((observation) => observation.sourceSliceId === dataset.sourceSliceId),
    `в наборе использован только срез ${dataset.sourceSliceId}; контрольные срезы: ${otherSlices.join(", ") || "—"}`,
  );

  // F. детерминированность
  push(
    "deterministic_build",
    determinism.identical,
    determinism.identical
      ? `${determinism.runs} независимых построения дали идентичный результат (checksum ${dataset.provenance.checksum?.slice(0, 16)}…)`
      : `результаты ${determinism.runs} построений различаются`,
  );

  // Дубли и потери
  push(
    "no_duplicate_dates",
    new Set(dataset.observations.map((observation) => observation.date)).size === dataset.observations.length,
    `дат ${new Set(dataset.observations.map((observation) => observation.date)).size} при ${dataset.observations.length} записях`,
  );
  push(
    "no_lost_rows",
    reconciliationRows.every((row) => row.sourceRows === 1),
    `строк исходного среза на дату: ${[...new Set(reconciliationRows.map((row) => row.sourceRows))].join(", ")}`,
  );

  const datasetsQuality = dataset.observations.every((observation) => observation.qualityStatus === "full");
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const status: ReconciliationResult["status"] = hasErrors ? "BLOCKED" : datasetsQuality && matchesExpected !== false ? "PASS" : "CONDITIONAL";

  return {
    status,
    counts: {
      sourceRowsForMetric: rows.length,
      sourceDailyRows: sliceDaily.length,
      sourceTotalsRows: sliceTotals.length,
      canonicalRows: dataset.observations.length,
      dates: new Set(dataset.observations.map((observation) => observation.date)).size,
      excludedTotals: dataset.excludedTotalsRows,
      rejectedRows: sliceDaily.length - dataset.observations.length,
      conflicts: valueMismatches.length,
    },
    period: {
      from: dataset.period.from,
      to: dataset.period.to,
      days: dataset.period.days,
      expectedFrom: expected?.from ?? null,
      expectedTo: expected?.toInclusive ?? null,
      matches: periodMatches,
    },
    totals: {
      sourceTotal,
      canonicalTotal: dataset.totalDelivered,
      equal: totalsEqual,
      expectedTotal: expected?.total ?? null,
      matchesExpected,
    },
    rows: reconciliationRows,
    crossSliceMismatches: crossMismatches.length,
    determinism: { runs: determinism.runs, identical: determinism.identical, checksum: dataset.provenance.checksum ?? "" },
    issues,
    checks,
  };
}
