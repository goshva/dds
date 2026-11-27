/**
 * TPL-4.1: реестр страниц эталонов и сборка их содержимого.
 * Каждая страница вызывает production-функции; собственная разметка компонентов не дублируется.
 */
import { card, pageHeader, statusBadge, trusted, type TrustedHtml } from "../../src/web/components/index";
import { PAGES, REFERENCE_NOTICE, type PageKey } from "./fixtures/common";
import { historyContent, historyRangeContent } from "./fixtures/history";
import { overviewContent } from "./fixtures/overview";
import { provenanceContent } from "./fixtures/provenance";
import { qualityContent } from "./fixtures/quality";
import { forecastQualityContent } from "./fixtures/forecast-quality";
import { diagnosticsContent } from "./fixtures/forecast-diagnostics";
import { indexContent } from "./render-shell";

const BUILDERS: Record<PageKey, () => TrustedHtml> = {
  overview: overviewContent,
  history: historyContent,
  quality: qualityContent,
  provenance: provenanceContent,
  "forecast-quality": forecastQualityContent,
  "forecast-diagnostics": diagnosticsContent,
};

export function pageContent(key: PageKey): TrustedHtml {
  const builder = BUILDERS[key];
  if (!builder) throw new Error(`TPL-4.1: нет сборщика для страницы ${key}`);
  // «История» дополнительно показывает контролируемый произвольный диапазон (синтетические даты).
  const body = key === "history" ? trusted(`${builder()}${historyRangeContent()}`) : builder();
  return body;
}

export function indexPath(): string {
  return "index.html";
}

export function indexPageContent(): TrustedHtml {
  const header = pageHeader({
    title: "Эталоны страниц DSS",
    subtitle: "Шесть страниц, сгенерированных из production-компонентов · синтетические данные",
    right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "PROVISIONAL" })} ${statusBadge({ status: "PENDING", text: REFERENCE_NOTICE })}`),
  });
  const list = card({
    title: "Страницы",
    subtitle: "состав соответствует маршрутам production-приложения",
    body: trusted(`<ul class="ds-ref-index">${PAGES.map((page) => `<li><a href="pages/${page.file}"><b>${page.title}</b><div class="ds-sub ds-ref-note">${page.description}</div></a></li>`).join("")}</ul>`),
  });
  const notes = card({
    title: "Ограничения эталонов",
    body: trusted(`<ul class="ds-sub">
  <li>Разметка собрана production-компонентами <code>src/web/components</code> и функциями страниц.</li>
  <li>Данные синтетические: ${REFERENCE_NOTICE}; не являются показателями магазина.</li>
  <li>Нет подключения к API, сети, SQLite и JSONL; состояния показаны статически.</li>
  <li>Команда генерации: <code>bun tools/reference/generate.ts</code>.</li>
</ul>`),
  });
  const banner = trusted(`<div class="ds-ref-banner">${statusBadge({ status: "CONFLICT", text: REFERENCE_NOTICE })}<span class="ds-sub">Демонстрационные значения; интерфейс приложения использует реальные данные.</span></div>`);
  return indexContent(header, list, notes, banner);
}
