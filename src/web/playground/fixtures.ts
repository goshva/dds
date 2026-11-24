/**
 * FIXTURE-данные для playground (Stage UI-1).
 * НЕ импортировать в production-модули src/web/{components,lib,app}.
 * Значения вымышлены и служат только для визуальной проверки компонентов.
 */
export const FIXTURE = {
  shopNo: "7745",
  slices: [
    { date: "2026-11-01", value: 1620 },
    { date: "2026-11-02", value: 1710 },
    { date: "2026-11-03", value: 1595 },
    { date: "2026-11-04", value: 1688 },
    { date: "2026-11-05", value: 1742 },
    { date: "2026-11-06", value: 1805 },
    { date: "2026-11-07", value: 1650 },
  ],
  calendar: [
    { date: "2026-11-01", status: "full" as const },
    { date: "2026-11-02", status: "full" as const },
    { date: "2026-11-03", status: "partial" as const },
    { date: "2026-11-04", status: "full" as const },
    { date: "2026-11-05", status: "missing" as const },
    { date: "2026-11-06", status: "full" as const },
    { date: "2026-11-07", status: "unknown" as const },
  ],
  table: {
    columns: [
      { key: "date", label: "Дата" },
      { key: "value", label: "Заказы", numeric: true },
      { key: "status", label: "Статус" },
    ],
    rows: [
      { date: "2026-11-01", value: 1620, status: "OK" },
      { date: "2026-11-02", value: 1710, status: "OK" },
      { date: "2026-11-03", value: 1595, status: "PENDING" },
    ],
  },
} as const;