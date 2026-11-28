/** FINAL-3.3.2.2: блок «Снапшоты прогнозов» (`/api/v1/forecasts`). Только отображение DTO. */
import { card, dataTable, formatDate, formatNumber, kpiGrid, statusBadge, trusted, type TrustedHtml } from "../components";
import type { ApiResult } from "../api/client";

/** Поля записи 1:1 из `ForecastItemDto` (backend). */
export interface ForecastItemView {
  snapshotId: string;
  mode: string;
  modelId: string;
  modelVersion: string;
  variant: string | null;
  horizon: number;
  originDate: string;
  targetDate: string;
  forecastValue: number | null;
  status: string;
  inputDataVersion: string;
  generatedAt: string;
}

/** Provenance доступен только у ответа снапшотов. */
export interface ForecastProvenanceView {
  datasetChecksums: string[];
  datasetVersionWarning: boolean;
  manifestStatus: "OK" | "NOT_AVAILABLE" | "CORRUPTED";
  manifestDatasetChecksum: string | null;
  freshness: "MATCH" | "STALE" | "NOT_CONFIRMED";
  shadowFileChecksums: Record<string, string>;
}

export interface ForecastsListView {
  mode: string;
  horizon: number;
  total: number;
  returned: number;
  items: ForecastItemView[];
  provenance: ForecastProvenanceView;
}

const NO_VALUE = "Нет значения";

/** Значение прогноза: null — отсутствие, 0 — реальный ноль. */
export function forecastValueText(value: number | null): string {
  return value === null ? NO_VALUE : formatNumber(value);
}

function provenanceLine(provenance: ForecastProvenanceView): string {
  const checksums = provenance.datasetChecksums.length > 0 ? provenance.datasetChecksums.join(", ") : "недоступны";
  const files = Object.entries(provenance.shadowFileChecksums).map(([name, sum]) => `${name}: ${sum}`);
  const manifest = provenance.manifestDatasetChecksum ?? "неизвестна";
  return [
    `freshness: ${provenance.freshness}`,
    `manifest: ${provenance.manifestStatus}`,
    `checksum данных: ${manifest}`,
    `checksums: ${checksums}`,
    files.length > 0 ? `файлы: ${files.join("; ")}` : "файлы: недоступны",
  ].join(" · ");
}

/** Готовый блок снапшотов (используется после успешного ответа). */
export function snapshotsCard(data: ForecastsListView): TrustedHtml {
  const warning = data.provenance.datasetVersionWarning
    ? ` ${statusBadge({ status: "PENDING", text: "обнаружено различие версий набора данных" })}`
    : "";
  const table = dataTable({
    columns: [
      { key: "generatedAt", label: "Дата формирования" },
      { key: "originDate", label: "Дата происхождения" },
      { key: "targetDate", label: "Дата прогноза" },
      { key: "model", label: "Модель" },
      { key: "modelVersion", label: "Версия модели" },
      { key: "variant", label: "Вариант" },
      { key: "value", label: "Прогноз", numeric: true },
      { key: "status", label: "Статус" },
      { key: "inputDataVersion", label: "Версия входных данных" },
      { key: "snapshotId", label: "Snapshot ID" },
    ],
    rows: data.items.map((item) => ({
      generatedAt: formatDate(item.generatedAt),
      originDate: formatDate(item.originDate),
      targetDate: formatDate(item.targetDate),
      model: item.modelId,
      modelVersion: item.modelVersion,
      variant: item.variant ?? "—",
      value: forecastValueText(item.forecastValue),
      status: item.status,
      inputDataVersion: item.inputDataVersion,
      snapshotId: item.snapshotId,
    })),
    emptyText: "Для выбранных режима и горизонта записей нет",
  });
  return card({
    title: "Снапшоты прогнозов",
    subtitle: `режим ${data.mode} · горизонт h${data.horizon} · показаны последние ${formatNumber(data.returned)} из ${formatNumber(data.total)} записей`,
    right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "семантика PROVISIONAL" })}${warning}`),
    body: trusted(`
${kpiGrid([
      { label: "Всего в выборке", value: formatNumber(data.total), note: "существующие снапшоты режима и горизонта", status: "OK" },
      { label: "Показано", value: formatNumber(data.returned), note: "сервер возвращает последние N записей", status: "OK" },
    ])}
${table}
<div class="ds-sub">Источник: ${provenanceLine(data.provenance)}</div>`),
  });
}

/** Состояние блока до/вместо данных: loading, not_available, error. */
export function snapshotsBlock(result: ApiResult<ForecastsListView> | null, mode: string, horizon: number): TrustedHtml {
  if (result === null) return card({ title: "Снапшоты прогнозов", body: trusted('<div class="ds-sub" data-ds-forecast-snapshots-loading>Загрузка списка прогнозов…</div>') });
  if (result.status === "not_available") {
    return card({
      title: "Снапшоты прогнозов",
      subtitle: `режим ${mode} · горизонт h${horizon}`,
      body: trusted(`<div class="ds-sub" data-ds-forecast-snapshots-empty>Для выбранных режима и горизонта прогнозов нет (код: ${result.meta.reason ?? "NO_RECORDS_FOR_MODE_AND_HORIZON"}).</div>`),
    });
  }
  if (result.status === "error") {
    return card({
      title: "Снапшоты прогнозов",
      subtitle: `режим ${mode} · горизонт h${horizon}`,
      body: trusted(`<div class="ds-sub" data-ds-forecast-snapshots-error>Не удалось получить список прогнозов: ${result.error.message} (код ${result.error.code}).</div>`),
    });
  }
  return snapshotsCard(result.data);
}
