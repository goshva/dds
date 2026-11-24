/**
 * Stage 3.2.2 — доказательный выбор канонического среза.
 *
 * Правило: каноническим может стать только срез, который НЕ требует агрегации измерений
 * (одна строка на дату) либо позволяет доказать взаимоисключаемость и полноту категорий.
 * Если доказательств нет — возвращается BLOCKED, а не «наиболее вероятный» срез.
 */

import type { CrossSliceRow, DecisionStatus, SliceCandidateStats } from "./types";

export interface SelectionResult {
  status: DecisionStatus;
  sliceId: number | null;
  reasons: string[];
  evidence: string[];
  rejected: Array<{ sliceId: number; reason: string }>;
  alternatives: Array<{ sliceId: number; role: string; note: string }>;
}

/** Критерии пригодности среза как канонического источника. */
export function rejectReasons(candidate: SliceCandidateStats): string[] {
  const reasons: string[] = [];
  if (candidate.maskedDimension1 > 0 || candidate.maskedDimension2 > 0) {
    reasons.push(
      `содержит плейсхолдеры маскирования (dim1: ${candidate.maskedDimension1}, dim2: ${candidate.maskedDimension2}) — возможна коллизия разных сущностей`,
    );
  }
  if (candidate.duplicateKeys > 0) reasons.push(`${candidate.duplicateKeys} дублирующихся ключей (дата + измерения)`);
  if (candidate.nullValues > 0) reasons.push(`${candidate.nullValues} наблюдений со значением NULL`);
  if (candidate.negativeValues > 0) reasons.push(`${candidate.negativeValues} отрицательных значений`);
  if (candidate.fractionalValues > 0) reasons.push(`${candidate.fractionalValues} дробных значений`);
  if (candidate.totalsRows > 0) reasons.push(`${candidate.totalsRows} итоговых строк без даты смешаны с дневными`);
  if (candidate.dates === 0) reasons.push("нет дневных наблюдений");
  return reasons;
}

export function selectCanonicalSource(
  candidates: readonly SliceCandidateStats[],
  crossSlice: readonly CrossSliceRow[],
  expectedDays: number,
): SelectionResult {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const rejected: Array<{ sliceId: number; reason: string }> = [];

  if (!candidates.length) {
    return {
      status: "BLOCKED",
      sliceId: null,
      reasons: ["нет ни одного среза с целевой метрикой"],
      evidence,
      rejected,
      alternatives: [],
    };
  }

  // межсрезовая сверка должна сходиться: иначе источник выбрать нельзя
  const mismatchedDates = crossSlice.filter((row) => !row.allEqual);
  const crossSliceOk = mismatchedDates.length === 0 && crossSlice.every((row) => row.slicesCompared === candidates.length);
  if (!crossSliceOk) {
    reasons.push(
      `дневные суммы срезов расходятся на ${mismatchedDates.length} датах` +
        (mismatchedDates.length ? ` (например, ${mismatchedDates[0]!.date}: ${JSON.stringify(mismatchedDates[0]!.totalsBySlice)})` : ""),
    );
  } else {
    evidence.push(`дневные суммы всех ${candidates.length} срезов совпадают на всех ${crossSlice.length} датах`);
  }

  // Отбор: сначала срезы без структурных дефектов, затем — с одной строкой на дату
  const structurallyClean: SliceCandidateStats[] = [];
  for (const candidate of candidates) {
    const problems = rejectReasons(candidate);
    const calendarProblem = candidate.calendarComplete ? null : `неполный календарь: ${candidate.dates} из ${expectedDays} дней`;
    if (problems.length || calendarProblem) {
      rejected.push({ sliceId: candidate.sliceId, reason: [...problems, calendarProblem].filter(Boolean).join("; ") });
      continue;
    }
    structurallyClean.push(candidate);
  }

  const singleRow = structurallyClean.filter((candidate) => candidate.singleRowPerDate);

  if (singleRow.length === 1) {
    const chosen = singleRow[0]!;
    evidence.push(
      `срез ${chosen.sliceId}: ровно одна строка на дату (${chosen.dates} дат), ` +
        `измерений в строке: dim1=${chosen.dimension1Values}, dim2=${chosen.dimension2Values} — агрегация измерений не требуется`,
    );
    evidence.push(`срез ${chosen.sliceId}: сумма за период ${chosen.dailyTotal}, дублей ${chosen.duplicateKeys}, NULL ${chosen.nullValues}`);
    evidence.push("агрегация категорий не выполняется: значение строки берётся как есть");
    const alternatives = structurallyClean
      .filter((candidate) => candidate.sliceId !== chosen.sliceId)
      .map((candidate) => ({
        sliceId: candidate.sliceId,
        role: "контрольный источник",
        note: `дневные суммы совпадают с каноническим срезом; требует агрегации ${candidate.dimensionCombinations} комбинаций измерений`,
      }));
    for (const rejectedCandidate of rejected) alternatives.push({ sliceId: rejectedCandidate.sliceId, role: "не используется", note: rejectedCandidate.reason });

    return {
      status: crossSliceOk && reasons.length === 0 ? "CONFIRMED" : "BLOCKED",
      sliceId: chosen.sliceId,
      reasons: reasons.length ? reasons : ["выбран единственный срез с одной строкой на дату и полным календарём"],
      evidence,
      rejected,
      alternatives,
    };
  }

  if (singleRow.length > 1) {
    reasons.push(`несколько срезов имеют по одной строке на дату: ${singleRow.map((c) => c.sliceId).join(", ")} — выбор неоднозначен`);
    return { status: "BLOCKED", sliceId: null, reasons, evidence, rejected, alternatives: [] };
  }

  // Срезов с одной строкой на дату нет: агрегация категорий требует доказательств аддитивности
  reasons.push(
    "ни один срез не представляет магазин одной строкой на дату: требуется доказать взаимоисключаемость и полноту категорий перед агрегацией",
  );
  return { status: "BLOCKED", sliceId: null, reasons, evidence, rejected, alternatives: [] };
}
