/** Публичный интерфейс компонентов DSS UI (Stage UI-1). */
export { appShell, pageHeader, sidebar, topbar, type AppShellProps, type NavItem, type NavSection, type TopbarProps } from "./shell";
export { card, chartCard, kpiCard, kpiGrid, provenanceDrawer, statusBadge, type CardProps, type ChartCardProps, type KpiCardProps, type ProvenanceDrawerProps, type StatusBadgeProps } from "./cards";
export { completenessCalendar, dataTable, sparkline, type CalendarDay, type CalendarDayStatus, type DataTableProps, type TableColumn } from "./data";
export { emptyState, errorState, loadingState } from "./states";
export { barChart, isSeriesClass, lineChart, type Series, type SeriesClass, type SeriesPoint } from "./charts";
export type { DssStatus } from "../lib/format";
export { escapeHtml, formatDate, formatNumber, formatPercent, isSafeHref, safeHref, statusClass, statusLabel, trusted, type TrustedHtml } from "../lib/format";