/**
 * UI-7.1.1 — страница «Диагностика прогнозирования» (fallback-реализация на существующем API).
 *
 * Принципы (см. docs/ui/ui-7-1-specification.md, ui-7-1-data-contract-matrix.md):
 *  1. Показываем только то, что реально возвращает API. Метрики на frontend не пересчитываются.
 *  2. Persisted errors (errors.jsonl) недоступны → показываем NOT_AVAILABLE, не «0 ошибок».
 *  3. Computed diagnostics (quality/errors) и operational status (provenance) — раздельные блоки.
 *  4. Replay и shadow не смешиваются; `meta.generatedAt` — время ответа API, а не дата последних фактов.
 *  5. errors endpoint не фильтруется по горизонту — это явно обозначено в интерфейсе.
 */
import {
  card,
  dataTable,
  emptyState,
  errorState,
  escapeHtml,
  formatDate,
  formatNumber,
  kpiGrid,
  loadingState,
  pageHeader,
  provenanceDrawer,
  statusBadge,
  trusted,
  type TrustedHtml,
} from "../components";
import type { ApiResult } from "../api/client";
import type { QualityDto, MetricsDto } from "./forecast-quality";

/** DTO из `src/server/services/forecasting-read-models.ts` (только реально присутствующие поля). */
export type DiagnosticsMode = "replay" | "shadow";

export interface ForecastErrorItemDto {
  source: "persisted" | "detected";
  kind: string;
  snapshotId: string | null;
  recordType: "snapshot" | "reconciliation" | "file";
  reason: string;
}

export interface ForecastErrorsDto {
  mode: DiagnosticsMode;
  total: number;
  persistedErrorsAvailable: boolean;
  items: ForecastErrorItemDto[];
}

const MODE_LABEL: Record<DiagnosticsMode, string> = {
  replay: "Историческая диагностика (Replay)",
  shadow: "Текущий Shadow Mode",
};

const INTERPRETABILITY_LABEL: Record<string, string> = {
  NOT_AVAILABLE: "сравнение недоступно",
  INSUFFICIENT: "недостаточно наблюдений",
  LIMITED: "ограниченная интерпретация",
  NOT_ASSESSED: "не оценивалось",
};

const FRESHNESS_STATUS: Record<string, "OK" | "PENDING" | "NOT_AVAILABLE"> = {
  MATCH: "OK",
  STALE: "PENDING",
  NOT_CONFIRMED: "NOT_AVAILABLE",
};

/** Человекочитаемое пояснение freshness (без вывода о корректности модели). */
function freshnessNote(freshness: string): string {
  if (freshness === "MATCH") return "Версия фактов совпадает с подтверждённой в manifest.";
  if (freshness === "STALE") return "Версия фактов расходится с manifest. Это не доказывает ошибочность прогноза.";
  return "Соответствие версии фактов и manifest не подтверждено.";
}

/** Предупреждения о версии данных расшифровываются человеческим языком. */
function warningText(code: string): string {
  if (code === "DATASET_VERSION_DIFFERS") return "В выборке присутствуют несколько версий dataset_checksum — сравнение ограничено.";
  if (code === "UNKNOWN_DATASET_VERSION") return "Версия dataset_checksum неизвестна.";
  if (code === "PENDING_OBSERVATIONS_PRESENT") return "Есть прогнозы, ожидающие факта (pending). Это не ошибка.";
  return code;
}

function isFiniteMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Метрика показывается только если значение конечно и n безопасно; иначе [Н/Д] — не ноль. */
function metricCell(metric: MetricsDto | undefined, field: "mae" | "wape" | "bias"): string {
  if (!metric || !Number.isSafeInteger(metric.n) || metric.n <= 0) return "[Н/Д]";
  const value = metric[field];
  if (!isFiniteMetric(value)) return "[Н/Д]";
  return formatNumber(value, 2);
}

/** Список секунд вокруг ключа "Параметры" — switch режима/горизонта через hash. */
function modeSwitcher(mode: DiagnosticsMode, horizon: number): TrustedHtml {
  return trusted(
    (["replay", "shadow"] as const)
      .map((item) => `<a class="ds-badge ${item === mode ? "ds-badge--ok" : "ds-badge--na"}" href="#forecast-diagnostics/${item}/${horizon}">${escapeHtml(MODE_LABEL[item])}</a>`)
      .join(" "),
  );
}

function horizonSwitcher(mode: DiagnosticsMode, horizon: number): TrustedHtml {
  return trusted(
    ([1, 3] as const)
      .map((item) => `<a class="ds-badge ${item === horizon ? "ds-badge--provisional" : "ds-badge--na"}" href="#forecast-diagnostics/${mode}/${item}">h${item}</a>`)
      .join(" "),
  );
}

/** Блок A. Показываем meta.generatedAt, состояние загрузки, ошибку запроса. */
function statusBlock(input: { mode: DiagnosticsMode; horizon: number; qualityStatus: string; errorsStatus: string; generatedAt: string | null }): TrustedHtml {
  return card({
    title: "Состояние диагностики",
    subtitle: "время формирования ответа API не является временем последнего наблюдения данных",
    body: trusted(`<div class="ds-row" style="flex-wrap:wrap">
  ${statusBadge({ status: "PROVISIONAL", text: input.mode === "replay" ? "REPLAY" : "SHADOW" })}
  ${statusBadge({ status: "PROVISIONAL", text: `h${input.horizon}` })}
  ${statusBadge({ status: input.qualityStatus === "ok" ? "OK" : input.qualityStatus === "not_available" ? "NOT_AVAILABLE" : "CONFLICT", text: `quality: ${input.qualityStatus}` })}
  ${statusBadge({ status: input.errorsStatus === "ok" ? "OK" : input.errorsStatus === "not_available" ? "NOT_AVAILABLE" : "CONFLICT", text: `errors: ${input.errorsStatus}` })}
</div>
<div class="ds-sub" style="margin-top:8px">Параметры: ${escapeHtml(MODE_LABEL[input.mode])} · горизонт h${input.horizon}</div>
<div class="ds-sub" style="margin-top:6px">Время формирования ответа API (meta.generatedAt): <b>${escapeHtml(input.generatedAt ?? "NOT_AVAILABLE")}</b></div>`),
  });
}

/** Блок B. Качество прогноза — только DTO quality. Не пересчитываем. */
function qualityBlock(result: ApiResult<QualityDto>): TrustedHtml {
  if (result.status === "not_available") {
    return card({
      title: "Качество прогноза",
      body: emptyState({ title: "Данные качества недоступны", detail: `причина: ${result.meta.reason ?? "UNKNOWN"}` }),
    });
  }
  if (result.status === "error") {
    return card({
      title: "Качество прогноза",
      body: errorState({ title: "Ошибка запроса качества", detail: result.error.message, code: `${result.error.code} · ${result.error.eventId.slice(0, 8)}` }),
    });
  }
  const data = result.data;
  const maeStatus = data.independentMetrics.length ? data.sampleStatus : "NOT_AVAILABLE";
  const interpretabilityStatus = (data.interpretabilityStatus === "LIMITED" ? "PENDING" : data.interpretabilityStatus === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : "PENDING") as "OK" | "PENDING" | "NOT_AVAILABLE" | "CONFLICT" | "PROVISIONAL" | "FALLBACK";
  const baseline = data.independentMetrics.find((metric) => metric.modelId === "rolling_7_day_mean");
  const candidate = data.independentMetrics.find((metric) => metric.modelId === "adaptive_baseline");
  const counters = data.pairCounters;
  const pendingCardStatus = counters.pendingN > 0 ? "PENDING" : "OK";
  const cards = [
    { label: "pairedN", value: formatNumber(counters.pairedN), note: "парная выборка (доступна для сравнения моделей)", status: "PENDING" as never },
    { label: "Ожидают факта (pending)", value: formatNumber(counters.pendingN), note: "pending ≠ ошибка", status: pendingCardStatus as never },
    { label: "Исключено baseline", value: formatNumber(counters.excludedBaselineN), note: "per-record причина недоступна в API", status: "PENDING" as never },
    { label: "Исключено candidate", value: formatNumber(counters.excludedCandidateN), note: "per-record причина недоступна в API", status: "PENDING" as never },
    { label: "Конфликты", value: formatNumber(counters.conflictN), status: (counters.conflictN ? "CONFLICT" : "OK") as never },
    { label: "Неизвестные записи", value: formatNumber(counters.unknownN), status: (counters.unknownN ? "PENDING" : "OK") as never },
    { label: "Полнота выборки", value: data.sampleStatus, note: "техническая полнота, не статистическая достаточность", status: (maeStatus === "COMPLETE" ? "OK" : maeStatus === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : "PENDING") as never },
    { label: "Интерпретируемость", value: data.interpretabilityStatus, note: INTERPRETABILITY_LABEL[data.interpretabilityStatus] ?? "", status: interpretabilityStatus as never },
  ];
  const metricsTable = data.independentMetrics.length
    ? dataTable({
        columns: [
          { key: "model", label: "Модель" },
          { key: "n", label: "n", numeric: true },
          { key: "mae", label: "MAE", numeric: true },
          { key: "wape", label: "WAPE", numeric: true },
          { key: "bias", label: "Bias", numeric: true },
          { key: "sample", label: "Полнота" },
        ],
        rows: data.independentMetrics.map((metric) => ({
          model: metric.modelId,
          n: Number.isSafeInteger(metric.n) ? metric.n : "NOT_AVAILABLE",
          mae: metricCell(metric, "mae"),
          wape: metricCell(metric, "wape"),
          bias: metricCell(metric, "bias"),
          sample: metric.sampleStatus,
        })),
      })
    : emptyState({ title: "Метрики недоступны", detail: "API не вернул independentMetrics для этого среза" });
  const warnings = data.warnings.length
    ? trusted(`<ul class="ds-sub">${data.warnings.map((warning) => `<li>${escapeHtml(warningText(warning))}</li>`).join("")}</ul>`)
    : trusted(`<div class="ds-sub">Предупреждений нет.</div>`);
  return card({
    title: "Качество прогноза",
    subtitle: "только данные quality endpoint; frontend-метрики не пересчитываются",
    body: trusted(`
${kpiGrid(cards)}
${card({ title: "Метрики моделей", subtitle: "описательно; статус интерпретируемости выше", body: metricsTable })}
${card({ title: "Предупреждения API", body: warnings })}
`),
  });
}

/** Блок C. Обнаруженные диагностические записи — только errors endpoint (mode-wide). */
function errorsBlock(result: ApiResult<ForecastErrorsDto>): TrustedHtml {
  const explanation = "Диагностические записи возвращаются для выбранного режима целиком. API не поддерживает фильтрацию этого списка по горизонту.";
  if (result.status === "not_available") {
    return card({
      title: "Обнаруженные диагностические записи",
      subtitle: explanation,
      body: emptyState({ title: "Диагностических записей нет", detail: `API вернул not_available · причина: ${result.meta.reason ?? "UNKNOWN"}. Это не «ошибок нет».` }),
    });
  }
  if (result.status === "error") {
    return card({
      title: "Обнаруженные диагностические записи",
      subtitle: explanation,
      body: errorState({ title: "Ошибка запроса диагностики", detail: result.error.message, code: `${result.error.code} · ${result.error.eventId.slice(0, 8)}` }),
    });
  }
  const data = result.data;
  const persisted = data.persistedErrorsAvailable
    ? statusBadge({ status: "OK", text: "Journal: доступен" })
    : statusBadge({ status: "NOT_AVAILABLE", text: "Journal: N/A" });
  if (!data.items.length) {
    return card({
      title: "Обнаруженные диагностические записи",
      subtitle: explanation,
      body: trusted(`<div class="ds-row" style="margin-bottom:8px">${persisted}</div>${emptyState({ title: "Успешный пустой набор", detail: "API вернул успешный ответ без обнаруженных записей." })}`),
    });
  }
  const table = dataTable({
    columns: [
      { key: "source", label: "source" },
      { key: "kind", label: "kind" },
      { key: "snapshotId", label: "snapshotId" },
      { key: "recordType", label: "recordType" },
      { key: "reason", label: "reason" },
    ],
    rows: data.items.map((item) => ({
      source: item.source,
      kind: item.kind,
      snapshotId: item.snapshotId ?? "—",
      recordType: item.recordType,
      reason: item.reason,
    })),
  });
  return card({
    title: "Обнаруженные диагностические записи",
    subtitle: explanation,
    right: persisted,
    body: trusted(`<div class="ds-sub" style="margin-bottom:8px">total = ${formatNumber(data.total)} (items обрезаются по limit; лимит на стороне API).</div>${table}`),
  });
}

/** Блок D. Provenance и Shadow Mode — только поля DTO (без asOf/manifestVersion). */
function provenanceBlock(result: ApiResult<QualityDto>): TrustedHtml {
  if (result.status !== "ok") {
    return card({
      title: "Provenance и Shadow Mode",
      body: emptyState({ title: "Provenance недоступен", detail: "quality endpoint не вернул данные; проверка версий/checksums невозможна." }),
    });
  }
  const provenance = result.data.provenance;
  const manifestStatus = provenance.manifestStatus === "OK" ? "OK" : provenance.manifestStatus === "CORRUPTED" ? "CONFLICT" : "NOT_AVAILABLE";
  const freshnessStatus = FRESHNESS_STATUS[provenance.freshness] ?? "NOT_AVAILABLE";
  const datasetChecksums = provenance.datasetChecksums.length ? provenance.datasetChecksums.join(", ") : "[Н/Д]";
  const shadowChecksums = Object.entries(provenance.shadowFileChecksums);
  const shadowChecksumText = shadowChecksums.length ? shadowChecksums.map(([file, value]) => `${file}: ${value}`).join("\n") : "[Н/Д]";
  // Длинный текст не кладём в badge (у .ds-badge white-space:nowrap → выход за viewport на mobile).
  // Бейдж несёт только короткий код статуса; расшифровка — в теле карточки.
  const warningRow = provenance.datasetVersionWarning
    ? trusted(`<div class="ds-row" style="margin-bottom:8px;flex-wrap:wrap">${statusBadge({ status: "PENDING", text: "DATASET_VERSION_DIFFERS" })}<span class="ds-sub">Версия данных различается — сравнение ограничено.</span></div>`)
    : trusted(`<div class="ds-row" style="margin-bottom:8px;flex-wrap:wrap">${statusBadge({ status: "OK", text: "SINGLE_VERSION" })}<span class="ds-sub">Единая версия dataset_checksum.</span></div>`);
  return card({
    title: "Provenance и Shadow Mode",
    subtitle: "состояние источников; freshness само по себе не доказывает ошибочность прогноза",
    body: trusted(`
${warningRow}
${provenanceDrawer({
  source: "shadow JSONL (read-only) + canonical CSV",
  checksum: `dataset: ${datasetChecksums}`,
  version: `manifest: ${provenance.manifestStatus} · freshness: ${provenance.freshness}`,
  note: "manifest dataset_checksum доступен через API, но не в клиентском DTO",
})}
<div class="ds-sub" style="margin-top:8px"><b>freshness:</b> ${escapeHtml(freshnessNote(provenance.freshness))}</div>
<div class="ds-row" style="margin-top:6px;flex-wrap:wrap"><b class="ds-sub">manifest:</b> ${statusBadge({ status: manifestStatus as never, text: provenance.manifestStatus })}</div>
<div class="ds-row" style="margin-top:6px;flex-wrap:wrap">${statusBadge({ status: freshnessStatus as never, text: `freshness: ${provenance.freshness}` })}</div>
<pre class="ds-sub" style="white-space:pre-wrap;word-break:break-all;margin-top:8px">${escapeHtml("shadow file checksums:\n" + shadowChecksumText)}</pre>`),
  });
}

/** Блок E. Ограничения диагностики. */
function limitationsBlock(): TrustedHtml {
  return card({
    title: "Ограничения диагностики",
    body: trusted(`<ul class="ds-sub">
  <li><b>Сохранённый журнал ошибок недоступен</b> (<code>errors.jsonl</code> отсутствует): persisted errors показываются как NOT_AVAILABLE, а не как «0 ошибок».</li>
  <li><b>Per-record eligibility reasons не предоставляются:</b> API отдаёт только агрегаты (pendingN / excludedN), без причины по каждой записи.</li>
  <li><b>Полная детализация конфликтов не предоставляется:</b> списки duplicate / orphan / snapshotsWithoutReconciliation / actualConflicts в API отсутствуют.</li>
  <li><b>Ошибки API ≠ ошибки модели:</b> HTTP-ошибка или not_available источника не означает, что модель ошибочна.</li>
  <li><b>pending ≠ failed:</b> прогнозы с будущей target date ожидают появления факта и не являются сбоями.</li>
</ul>`),
  });
}

export interface ForecastDiagnosticsInput {
  mode: DiagnosticsMode;
  horizon: number;
  quality: ApiResult<QualityDto>;
  errors: ApiResult<ForecastErrorsDto>;
  /** Время формирования ответа API (quality.meta.generatedAt или errors.meta.generatedAt). */
  generatedAt: string | null;
}

/** Сборка страницы: блоки A-E, независимые состояния quality и errors. Общий shell задаётся в main.ts. */
export function forecastDiagnosticsPage(input: ForecastDiagnosticsInput): TrustedHtml {
  const qualityStatus = input.quality.status;
  const errorsStatus = input.errors.status;
  return trusted(`
${pageHeader({
  title: "Диагностика прогнозирования",
  subtitle: `режим: ${MODE_LABEL[input.mode]} · горизонт h${input.horizon} · replay и shadow не смешиваются`,
  right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "PROVISIONAL" })} ${statusBadge({ status: "NOT_AVAILABLE", text: "JOURNAL N/A" })}`),
})}
${card({
  title: "Параметры",
  subtitle: "переключение режима и горизонта меняет запросы к API",
  body: trusted(`<div class="ds-row">${modeSwitcher(input.mode, input.horizon)}<span class="ds-sub">|</span>${horizonSwitcher(input.mode, input.horizon)}</div>`),
})}
${statusBlock({ mode: input.mode, horizon: input.horizon, qualityStatus, errorsStatus, generatedAt: input.generatedAt })}
${qualityBlock(input.quality)}
${errorsBlock(input.errors)}
${provenanceBlock(input.quality)}
${limitationsBlock()}
`);
}

/** Состояние загрузки страницы (общая оболочка задаётся в main.ts). */
export function forecastDiagnosticsLoading(): TrustedHtml {
  return trusted(`${pageHeader({ title: "Диагностика прогнозирования", subtitle: "загрузка данных…" })}${loadingState({ rows: 6 })}`);
}

/** Прямой переход на несуществующий маршрут/параметры: использует общий errorState. */
export function forecastDiagnosticsInvalid(mode: string, horizon: string): TrustedHtml {
  return trusted(`${pageHeader({ title: "Диагностика прогнозирования" })}${errorState({ title: "Некорректные параметры диагностики", detail: `Режим «${mode}»/горизонт «${horizon}» не поддерживаются. Доступны: replay и shadow; горизонты 1 и 3.`, code: "INVALID_PARAMS" })}`);
}

/** Полезные экспорты для тестов без копирования логики. */
export const __diagnosticsInternals = {
  warningText,
  freshnessNote,
  metricCell,
  isFiniteMetric,
  MODE_LABEL,
  INTERPRETABILITY_LABEL,
};

/** Экспорт для ссылки из навигации/тестов: подтверждаем что addDiagnosticsPage реализовано в routing через PageKey. */
export type { TrustedHtml };
export { formatDate };
