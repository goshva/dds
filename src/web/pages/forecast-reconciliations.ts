/** FINAL-3.3.2.2: блок «Сверка с фактом» (`/api/v1/shadow/reconciliations`). Только DTO backend. */
import { card, dataTable, formatDate, formatNumber, kpiGrid, statusBadge, trusted, type TrustedHtml } from "../components";
import type { ApiResult } from "../api/client";

/** Поля записи 1:1 из `ReconciliationModel.items` (backend). */
export interface ReconciliationItemView {
  snapshotId: string;
  modelId: string;
  horizon: number;
  targetDate: string;
  forecastValue: number | null;
  actual: number;
  absoluteError: number;
  signedError: number;
}

export interface ReconciliationsView {
  mode: string;
  total: number;
  unknownSnapshots: number;
  items: ReconciliationItemView[];
  source: string | null;
  note: string | null;
}

const NO_VALUE = "Нет значения";

/** Значение: null — отсутствие, 0 — реальный ноль. Ошибки не пересчитываются. */
export function reconciliationValueText(value: number | null): string {
  return value === null ? NO_VALUE : formatNumber(value);
}

/** Готовый блок сверки. Provenance снапшотов сюда не переносится. */
export function reconciliationsCard(data: ReconciliationsView): TrustedHtml {
  const warning = data.unknownSnapshots > 0
    ? trusted(`<div class="ds-sub" data-ds-forecast-unknown>Часть записей сверки относится к неизвестным снапшотам и не включена в таблицу: ${formatNumber(data.unknownSnapshots)}. Это не количество ошибок прогноза.</div>`)
    : trusted('<div class="ds-sub" data-ds-forecast-unknown>Исключённых сверок без известного снапшота нет.</div>');
  const source = data.source ? `источник: ${data.source}` : "Источник не указан";
  const note = data.note ? ` · ${data.note}` : "";
  const table = dataTable({
    columns: [
      { key: "targetDate", label: "Дата прогноза" },
      { key: "model", label: "Модель" },
      { key: "forecast", label: "Прогноз", numeric: true },
      { key: "actual", label: "Факт", numeric: true },
      { key: "absoluteError", label: "Абсолютная ошибка", numeric: true },
      { key: "signedError", label: "Знаковая ошибка", numeric: true },
      { key: "snapshotId", label: "Snapshot ID" },
    ],
    rows: data.items.map((item) => ({
      targetDate: formatDate(item.targetDate),
      model: item.modelId,
      forecast: reconciliationValueText(item.forecastValue),
      actual: formatNumber(item.actual),
      absoluteError: formatNumber(item.absoluteError),
      signedError: formatNumber(item.signedError),
      snapshotId: item.snapshotId,
    })),
    emptyText: "Для выбранных режима и горизонта сверок нет",
  });
  return card({
    title: "Сверка с фактом",
    subtitle: `режим ${data.mode} · сверенное подмножество прогнозных записей · показано ${formatNumber(data.items.length)} из ${formatNumber(data.total)}`,
    right: statusBadge({ status: data.unknownSnapshots > 0 ? "PENDING" : "OK", text: data.unknownSnapshots > 0 ? "есть исключённые сверки" : "исключённых сверок нет" }),
    body: trusted(`
${kpiGrid([
      { label: "Сверок доступно", value: formatNumber(data.total), note: "не полный список прогнозов", status: "OK" },
      { label: "Неизвестных снапшотов", value: formatNumber(data.unknownSnapshots), note: "исключены backend из таблицы", status: data.unknownSnapshots > 0 ? "PENDING" : "OK" },
    ])}
${table}
${warning}
<div class="ds-sub">${source}${note}</div>`),
  });
}

/** Состояние блока до/вместо данных: loading, not_available, error. */
export function reconciliationsBlock(result: ApiResult<ReconciliationsView> | null, mode: string, horizon: number): TrustedHtml {
  if (result === null) return card({ title: "Сверка с фактом", body: trusted('<div class="ds-sub" data-ds-forecast-reconciliations-loading>Загрузка сверок с фактом…</div>') });
  if (result.status === "not_available") {
    return card({
      title: "Сверка с фактом",
      subtitle: `режим ${mode} · горизонт h${horizon}`,
      body: trusted(`<div class="ds-sub" data-ds-forecast-reconciliations-empty>Для выбранного режима и горизонта нет доступных сверок с фактом (код: ${result.meta.reason ?? "NO_RECONCILIATIONS"}).</div>`),
    });
  }
  if (result.status === "error") {
    return card({
      title: "Сверка с фактом",
      subtitle: `режим ${mode} · горизонт h${horizon}`,
      body: trusted(`<div class="ds-sub" data-ds-forecast-reconciliations-error>Не удалось получить сверки: ${result.error.message} (код ${result.error.code}).</div>`),
    });
  }
  return reconciliationsCard(result.data);
}
