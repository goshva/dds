/**
 * TPL-4.1: общие константы и служебная разметка reference-эталонов.
 * Только синтетические значения: без времени, случайности, API, SQLite и JSONL.
 */
import { card, emptyState, errorState, loadingState, statusBadge, trusted as trustedMarkup } from "../../../src/web/components/index";
import { trusted, type TrustedHtml } from "../../../src/web/lib/format";

export const REFERENCE_NOTICE = "REFERENCE DATA — NOT PRODUCTION DATA";

/** Фиксированная метка: генератор детерминирован и не использует текущее время. */
export const SYNTHETIC_GENERATED_AT = "2026-01-01T00:00:00.000Z";
export const SYNTHETIC_SOURCE = "reference fixtures";

export const PAGE_KEYS = ["overview", "history", "quality", "provenance", "forecast-quality", "forecast-diagnostics"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export interface PageMeta {
  key: PageKey;
  file: string;
  title: string;
  navLabel: string;
  description: string;
  topbarTitle: string;
  subtitle: string;
}

export const PAGES: PageMeta[] = [
  { key: "overview", file: "overview.html", title: "Обзор", navLabel: "Обзор", description: "История, теневой режим, актуальность источника, график и полнота", topbarTitle: "DSS · история и аналитика", subtitle: "магазин 7745 · Europe/Moscow · метрика delivered_orders_daily" },
  { key: "history", file: "history.html", title: "История заказов", navLabel: "История", description: "Показатели периода, фильтры, график и таблица наблюдений", topbarTitle: "DSS · история и аналитика", subtitle: "историческая динамика доставленных заказов" },
  { key: "quality", file: "quality.html", title: "Качество данных", navLabel: "Качество данных", description: "Полнота ряда, пропуски, календарь и ограничения качества", topbarTitle: "DSS · история и аналитика", subtitle: "полнота исторического ряда и пропуски" },
  { key: "provenance", file: "provenance.html", title: "Происхождение данных", navLabel: "Происхождение", description: "Источник, контрольные суммы, версия и актуальность", topbarTitle: "DSS · история и аналитика", subtitle: "источник, версия и актуальность данных" },
  { key: "forecast-quality", file: "forecast-quality.html", title: "Прогнозы и качество", navLabel: "Прогнозы и качество", description: "Независимые метрики, парное сравнение и ограничения интерпретации", topbarTitle: "DSS · история и аналитика", subtitle: "baseline и candidate, горизонты h1 и h3" },
  { key: "forecast-diagnostics", file: "forecast-diagnostics.html", title: "Диагностика прогнозирования", navLabel: "Диагностика прогнозирования", description: "Качество, диагностические записи и провенанс", topbarTitle: "DSS · история и аналитика", subtitle: "качество прогноза и обнаруженные диагностические записи" },
];

export function pageByKey(key: PageKey): PageMeta {
  const page = PAGES.find((item) => item.key === key);
  if (!page) throw new Error(`TPL-4.1: неизвестная страница ${key}`);
  return page;
}

/** Служебный баннер эталона: помечает данные как синтетические. */
export function referenceBanner(): TrustedHtml {
  return trusted(`<div class="ds-ref-banner">${statusBadge({ status: "CONFLICT", text: REFERENCE_NOTICE })}<span class="ds-sub">Значения синтетические: не являются показателями магазина и не используются приложением.</span></div>`);
}

export function apiMeta(): { generatedAt: string; source: string; readOnly: true } {
  return { generatedAt: SYNTHETIC_GENERATED_AT, source: SYNTHETIC_SOURCE, readOnly: true };
}

/** Синтетические идентификаторы: не выдаются за реальные контрольные суммы. */
export const SYNTHETIC_CHECKSUM = {
  normalized: "reference-normalized-0000",
  file: "reference-file-0000",
  manifest: "reference-manifest-0000",
  shadow: "reference-shadow-0000",
};

/** Блок состояний: использует production-компоненты состояний и фиксирует семантику PROVISIONAL. */
export function statesCard(): TrustedHtml {
  const body = trustedMarkup(`${loadingState({ rows: 3 })}${emptyState({ title: "Данные недоступны", detail: "причина: NOT_AVAILABLE" })}${errorState({ title: "Ошибка источника", detail: "Частичные данные не выдаются как полные.", code: "DATA_SOURCE_CORRUPTED" })}<div class="ds-row ds-ref-note">${statusBadge({ status: "PROVISIONAL", text: "семантика PROVISIONAL" })}${statusBadge({ status: "PENDING", text: "ожидают факта: 6" })}</div>`);
  return card({ title: "Состояния и семантика", subtitle: "загрузка, недоступность, ошибка; ожидание не является ошибкой", body });
}