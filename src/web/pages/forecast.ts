/**
 * FINAL-3.3.2.2: страница «Прогнозирование».
 *
 * Два независимых источника: снапшоты (`/api/v1/forecasts`) и сверки
 * (`/api/v1/shadow/reconciliations`). Расчёты метрик и объединение источников на frontend запрещены.
 */
import { card, pageHeader, statusBadge, trusted, type TrustedHtml } from "../components";
import { api, type ApiResult } from "../api/client";
import { loadResult } from "../app-result";
import { forecastHref, type ForecastHorizon, type ForecastMode } from "../routing";
import { reconciliationsBlock, type ReconciliationItemView, type ReconciliationsView } from "./forecast-reconciliations";
import { snapshotsBlock, type ForecastsListView } from "./forecast-snapshots";

interface ReconciliationsResponse { mode: string; total: number; unknownSnapshots: number; items: ReconciliationItemView[] }

const SNAPSHOTS_LIMIT = 200;
const RECONCILIATIONS_LIMIT = 60;

export interface ForecastPageInput {
  mode: ForecastMode;
  horizon: ForecastHorizon;
  snapshots: ApiResult<ForecastsListView> | null;
  reconciliations: ApiResult<ReconciliationsView> | null;
  generatedAt: string | null;
}

function modeSelector(mode: ForecastMode, horizon: ForecastHorizon): TrustedHtml {
  const link = (target: ForecastMode, label: string): string => {
    const href = forecastHref(target, horizon) ?? "#forecast/replay/1";
    const current = target === mode;
    return `<a class="ds-badge ${current ? "ds-badge--ok" : "ds-badge--na"}" href="${href}">${label}</a>`;
  };
  const horizonLink = (target: ForecastHorizon): string => {
    const href = forecastHref(mode, target) ?? "#forecast/replay/1";
    return `<a class="ds-badge ${target === horizon ? "ds-badge--ok" : "ds-badge--na"}" href="${href}">h${target}</a>`;
  };
  return trusted(`<div class="ds-row" data-ds-forecast-controls>
  <span class="ds-sub">режим:</span>${link("replay", "Replay")}${link("shadow", "Shadow")}
  <span class="ds-sub">горизонт:</span>${horizonLink(1)}${horizonLink(3)}
</div>`);
}

/** Страница целиком: оба блока рендерятся из собственных состояний. */
export function forecastPage(input: ForecastPageInput): TrustedHtml {
  const { mode, horizon } = input;
  const updated = input.generatedAt ? ` · ответ получен ${input.generatedAt}` : "";
  return trusted(`
${pageHeader({
    title: "Прогнозирование",
    subtitle: `Исторические прогнозы и результаты теневого наблюдения · режим ${mode} · горизонт h${horizon}${updated}`,
    right: statusBadge({ status: "PROVISIONAL", text: "семантика PROVISIONAL" }),
  })}
${modeSelector(mode, horizon)}
${snapshotsBlock(input.snapshots, mode, horizon)}
${reconciliationsBlock(input.reconciliations, mode, horizon)}
${card({
    title: "Переходы и ограничения",
    subtitle: "детальные расчёты выполняет backend на отдельных страницах",
    body: trusted(`<div class="ds-row">
  <a class="ds-badge ds-badge--provisional" href="#forecast-quality/${mode}/${horizon}">Качество моделей</a>
  <a class="ds-badge ds-badge--provisional" href="#forecast-diagnostics/${mode}/${horizon}">Диагностика</a>
</div>
<div class="ds-sub" data-ds-forecast-limitations>Целевая метрика qty_orders_delivered (PROVISIONAL). Снапшоты и сверки — независимые источники: сверки содержат только подмножество записей с фактом, отсутствие сверки не означает нулевую ошибку. Список прогнозов — последние ${SNAPSHOTS_LIMIT} записей, сверки — последние ${RECONCILIATIONS_LIMIT}. Серверного фильтра по датам и пагинации нет; метрики качества и ошибки не рассчитываются на frontend.</div>`),
  })}
`);
}

/**
 * Загружает обе части независимо: сбой или недоступность одного источника не влияет на другой.
 * Каждое состояние фиксируется отдельным вызовом `commit` (защита от устаревших ответов — у вызывающей стороны).
 */
export async function loadForecastPage(params: {
  mode: ForecastMode;
  horizon: ForecastHorizon;
  commit: (content: TrustedHtml) => void;
}): Promise<void> {
  const { mode, horizon, commit } = params;
  const base: ForecastPageInput = { mode, horizon, snapshots: null, reconciliations: null, generatedAt: null };
  commit(forecastPage(base));

  let snapshots: ApiResult<ForecastsListView> | null = null;
  let reconciliations: ApiResult<ReconciliationsView> | null = null;
  let generatedAt: string | null = null;

  const render = (): void => commit(forecastPage({ mode, horizon, snapshots, reconciliations, generatedAt }));

  // Блок 1: снапшоты.
  const snapshotsTask = loadResult(api.get<ForecastsListView>("/api/v1/forecasts", { mode, horizon, limit: SNAPSHOTS_LIMIT })).then((result) => {
    snapshots = result;
    if (result.status === "ok" || result.status === "not_available") generatedAt = result.meta.generatedAt;
    render();
  });

  // Блок 2: сверки — отдельный запрос, независимое состояние.
  const reconciliationsTask = loadResult(api.get<ReconciliationsResponse>("/api/v1/shadow/reconciliations", { mode, horizon, limit: RECONCILIATIONS_LIMIT })).then((result) => {
    reconciliations = result.status === "ok"
      ? { status: "ok", data: { ...result.data, source: result.meta.source ?? null, note: result.meta.note ?? null }, meta: result.meta }
      : result;
    render();
  });

  await Promise.all([snapshotsTask, reconciliationsTask]);
}
