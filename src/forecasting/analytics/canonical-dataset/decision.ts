/**
 * Stage 3.2.2 — зафиксированное решение о каноническом источнике.
 *
 * Решение принимается человеком/аналитиком на основании данных и ФИКСИРУЕТСЯ здесь.
 * Модуль не выбирает срез автоматически: CLI сверяет это решение с фактическим
 * состоянием данных и при расхождении останавливается со статусом BLOCKED,
 * а не переключает источник молча.
 *
 * Обоснование решения (проверено повторно на данных, см. slice-comparison.csv):
 *  - срез 20624 содержит ровно одну строку на дату (41 дата), измерение — сама ТТ
 *    «7745ДС_Мосфильмовская74», то есть весь даркстор без агрегации измерений;
 *  - дневные суммы 20624 совпадают с остальными четырьмя срезами на всех 41 дате;
 *  - 20403/20404/20405/20623 требуют суммирования 6–12 комбинаций измерений,
 *    аддитивность которых письменно не подтверждена; 20404 к тому же содержит
 *    плейсхолдер маскирования в dimension_1.
 */

import type { SelectionResult } from "./selection";
import type { SourceDecision } from "./types";

export const CANONICAL_DECISION: SourceDecision = {
  sliceId: 20624,
  status: "CONFIRMED",
  decidedAt: "2026-11-23T22:10:00.000Z",
  decidedBy: "Stage 3.2 — доказательный анализ срезов (см. slice-comparison.csv и cross-slice-reconciliation.csv)",
  reasons: [
    "срез 20624 представляет весь даркстор одной строкой на дату: агрегация измерений не требуется",
    "дневные суммы 20624 совпадают с четырьмя остальными срезами на всех 41 датах",
    "в срезе нет NULL, дублей, отрицательных и дробных значений, нет итоговых строк без даты",
    "dimension_1 содержит единственное значение — ТТ магазина 7745, плейсхолдеров маскирования нет",
  ],
  evidence: [
    "data: 41 дневная строка, ровно 1 строка на дату, сумма за период совпадает с контрольными срезами",
    "data: rows per day = 1..1, dimension combinations = 1",
    "stage-3.1: дневные итоги qty_orders_delivered совпадают между всеми пятью срезами",
  ],
  alternatives: [
    { sliceId: 20403, role: "контрольный источник", note: "разрез по 7 сервисам; сумма совпадает с канонической по каждому дню" },
    { sliceId: 20623, role: "контрольный источник", note: "разрез по 6 сервисам; набор категорий неполный в отдельные дни" },
    { sliceId: 20405, role: "контрольный источник", note: "разрез по сервисам и типам доставки (12 комбинаций)" },
  ],
  rejected: [
    { sliceId: 20404, reason: "dimension_1 содержит плейсхолдер маскирования <ФИО> — возможна коллизия сущностей" },
  ],
  note:
    "Дневные суммы остальных срезов используются только для независимой сверки и никогда не добавляются в канонический ряд.",
};

export interface DecisionVerification {
  ok: boolean;
  messages: string[];
}

/** Сверяет зафиксированное решение с фактическим результатом анализа данных. */
export function verifyDecision(decision: SourceDecision, selection: SelectionResult): DecisionVerification {
  const messages: string[] = [];
  if (decision.status === "BLOCKED") {
    messages.push("зафиксированное решение имеет статус BLOCKED");
    return { ok: false, messages };
  }
  if (decision.sliceId === null) {
    messages.push("в решении не указан slice_id");
    return { ok: false, messages };
  }
  if (selection.status === "BLOCKED") {
    messages.push(...selection.reasons);
    return { ok: false, messages };
  }
  if (selection.sliceId !== decision.sliceId) {
    messages.push(
      `данные указывают на срез ${selection.sliceId ?? "—"}, а зафиксировано решение о срезе ${decision.sliceId}: источник не переключается автоматически`,
    );
    return { ok: false, messages };
  }
  messages.push(`решение подтверждено данными: срез ${decision.sliceId} (${selection.status})`);
  return { ok: true, messages };
}
