/** Playground дизайн-системы DSS (UI-1). FIXTURE-данные, отображение без production-логики. */
import {
  appShell,
  barChart,
  card,
  chartCard,
  completenessCalendar,
  dataTable,
  emptyState,
  errorState,
  formatDate,
  formatNumber,
  kpiGrid,
  lineChart,
  loadingState,
  pageHeader,
  provenanceDrawer,
  sidebar,
  statusBadge,
  topbar,
  type DssStatus,
  trusted,
} from "../components";
import { FIXTURE } from "./fixtures";

const STATUSES: DssStatus[] = ["OK", "PENDING", "PROVISIONAL", "FALLBACK", "CONFLICT", "NOT_AVAILABLE"];

const chart = lineChart([
  { name: "actual", className: "actual", points: FIXTURE.slices.map((row) => ({ date: row.date, value: row.value })) },
  { name: "baseline", className: "baseline", points: FIXTURE.slices.map((row) => ({ date: row.date, value: row.value - 40 })) },
  { name: "candidate", className: "candidate", points: FIXTURE.slices.map((row) => ({ date: row.date, value: row.value + 25 })) },
]);

const body = `
${pageHeader({ title: "UI-1 · Дизайн-система", subtitle: "FIXTURE — демонстрационные значения, не данные DSS", right: statusBadge({ status: "PROVISIONAL", text: "FIXTURE" }) })}
<div class="ds-grid ds-grid--cards">
  ${card({ title: "KPI", subtitle: "карточки и статусы", body: kpiGrid([
    { label: "Последний факт", value: formatDate("2026-11-07"), note: "FIXTURE", status: "OK" },
    { label: "Прогноз h1", value: "1 711", note: "FIXTURE", status: "PENDING" },
    { label: "MAE", value: formatNumber(92.4, 1), note: "FIXTURE", status: "PROVISIONAL" },
    { label: "Конфликты", value: "0", note: "FIXTURE", status: "NOT_AVAILABLE" },
  ]) })}
  ${card({ title: "Статусы DSS", body: trusted(`<div class="ds-row">${STATUSES.map((status) => statusBadge({ status })).join("")}</div>`) })}
</div>
${chartCard({
  title: "LineChart",
  hint: "факт · baseline · candidate",
  legend: trusted(`<span><i class="ds-legend-dot" style="background:var(--ds-ink)"></i>факт</span><span><i class="ds-legend-dot" style="background:var(--ds-info)"></i>baseline</span><span><i class="ds-legend-dot" style="background:var(--ds-acc)"></i>candidate</span>`),
  chart: trusted(chart),
})}
<div class="ds-grid ds-grid--middle">
  ${card({ title: "BarChart", body: barChart(FIXTURE.slices.map((row) => ({ label: row.date.slice(5), value: row.value }))) })}
  ${card({ title: "Календарь полноты", body: completenessCalendar(FIXTURE.calendar as never) })}
</div>
${card({ title: "DataTable", subtitle: "обычное состояние", body: dataTable(FIXTURE.table as never) })}
${card({ title: "Провенанс", body: provenanceDrawer({ source: "FIXTURE", checksum: "fixture-checksum", version: "fixture/v1", note: "не production" }) })}
<div class="ds-grid ds-grid--middle">
  ${card({ title: "Пустое состояние", body: emptyState({ title: "Нет наблюдений", detail: "FIXTURE: период без данных" }) })}
  ${card({ title: "Ошибка", body: errorState({ title: "API недоступен", detail: "FIXTURE: имитация ошибки", code: "FIXTURE_ERROR" }) })}
</div>
<div class="ds-grid ds-grid--middle">
  ${card({ title: "Загрузка", body: loadingState({ rows: 5 }) })}
  ${card({ title: "Нет данных у спарклайна", body: trusted(`<div class="ds-row">${statusBadge({ status: "NOT_AVAILABLE" })}<span class="ds-sub">значение отсутствует — ноль не подставляется</span></div>`) })}
</div>
`;

const nav = sidebar({
  brandName: "DSS",
  brandSub: "модуль прогнозирования",
  sections: [
    { title: "Обзор", items: [{ href: "#overview", label: "Overview", current: true }] },
    { title: "Аналитика", items: [{ href: "#history", label: "История" }, { href: "#forecasts", label: "Прогнозы" }] },
  ],
});

document.getElementById("app")!.innerHTML = appShell({
  sidebar: nav,
  topbar: topbar({ title: "Дизайн-система · UI-1", shopNo: FIXTURE.shopNo, lastUpdated: "FIXTURE", sourceStatus: "OK" }),
  content: trusted(body),
});

document.querySelector("[data-ds-menu]")?.addEventListener("click", () => {
  document.querySelector("[data-ds-sidebar]")?.classList.toggle("is-open");
  document.querySelector("[data-ds-scrim]")?.classList.toggle("is-open");
});
document.querySelector("[data-ds-scrim]")?.addEventListener("click", () => {
  document.querySelector("[data-ds-sidebar]")?.classList.remove("is-open");
  document.querySelector("[data-ds-scrim]")?.classList.remove("is-open");
});
/* UI-2: DEMO-режим включается явно (?demo=1) и помечается в интерфейсе.
   В обычном режиме playground не использует fixtures: реальные данные приходят из API. */
if (new URLSearchParams(window.location.search).get("demo") !== "1") {
  const banner = document.createElement("div");
  banner.className = "ds-sub";
  banner.textContent = "Реальный режим: fixtures не используются. DEMO-данные доступны по ?demo=1";
  document.querySelector(".ds-content")?.prepend(banner);
}