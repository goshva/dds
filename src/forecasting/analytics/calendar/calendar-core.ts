/**
 * Stage 3.4.2 — календарное ядро: московские даты, праздники РФ, производные календарные признаки.
 *
 * Все вычисления выполняются в Europe/Moscow и не зависят от timezone операционной системы:
 * дата разбирается через Intl.DateTimeFormat с явным timeZone.
 */

export const MOSCOW_TIMEZONE = "Europe/Moscow";

/** Нерабочие праздничные дни РФ по ст. 112 ТК РФ (ежегодно повторяющиеся даты, месяц-день). */
export const STATUTORY_HOLIDAYS: ReadonlyArray<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "Новогодние каникулы" },
  { month: 1, day: 2, name: "Новогодние каникулы" },
  { month: 1, day: 3, name: "Новогодние каникулы" },
  { month: 1, day: 4, name: "Новогодние каникулы" },
  { month: 1, day: 5, name: "Новогодние каникулы" },
  { month: 1, day: 6, name: "Новогодние каникулы" },
  { month: 1, day: 7, name: "Рождество Христово" },
  { month: 1, day: 8, name: "Новогодние каникулы" },
  { month: 2, day: 23, name: "День защитника Отечества" },
  { month: 3, day: 8, name: "Международный женский день" },
  { month: 5, day: 1, name: "Праздник Весны и Труда" },
  { month: 5, day: 9, name: "День Победы" },
  { month: 6, day: 12, name: "День России" },
  { month: 11, day: 4, name: "День народного единства" },
];

/**
 * Переносы выходных дней по постановлениям Правительства РФ.
 * verified: подтверждено вторичным источником (КонсультантПлюс, цитата ст. 112 ТК РФ и постановления);
 * официальный первоисточник (publication.pravo.gov.ru) не проверялся → статус PARTIALLY_VERIFIED.
 */
export interface ShiftRecord {
  year: number;
  from: string;
  to: string;
  legalAct: string;
  verified: "PARTIALLY_VERIFIED" | "UNVERIFIED";
  source: string;
}

export const OFFICIAL_SHIFTS: readonly ShiftRecord[] = [
  { year: 2025, from: "2025-01-04", to: "2025-05-02", legalAct: "Постановление Правительства РФ от 04.10.2024 N 1335", verified: "PARTIALLY_VERIFIED", source: "consultant.ru (вторичный)" },
  { year: 2025, from: "2025-01-05", to: "2025-12-31", legalAct: "Постановление Правительства РФ от 04.10.2024 N 1335", verified: "PARTIALLY_VERIFIED", source: "consultant.ru (вторичный)" },
  { year: 2025, from: "2025-02-23", to: "2025-05-08", legalAct: "Постановление Правительства РФ от 04.10.2024 N 1335", verified: "PARTIALLY_VERIFIED", source: "consultant.ru (вторичный)" },
  { year: 2025, from: "2025-03-08", to: "2025-06-13", legalAct: "Постановление Правительства РФ от 04.10.2024 N 1335", verified: "PARTIALLY_VERIFIED", source: "consultant.ru (вторичный)" },
  { year: 2025, from: "2025-11-01", to: "2025-11-03", legalAct: "Постановление Правительства РФ от 04.10.2024 N 1335", verified: "PARTIALLY_VERIFIED", source: "consultant.ru (вторичный)" },
];

/** Годы, для которых переносы выходных подтверждены хотя бы вторичным источником. */
export const SHIFT_YEARS_VERIFIED = [2025];
/** Годы в исследуемом периоде, для которых переносы НЕ проверялись. */
export const SHIFT_YEARS_UNVERIFIED = [2024, 2026];

/** Сокращённые предпраздничные дни 2025 (ст. 95 ТК РФ), источник — КонсультантПлюс (вторичный). */
export const PRE_HOLIDAY_SHORT_DAYS_2025 = ["2025-03-07", "2025-04-30", "2025-06-11", "2025-11-01"];

export const DOW_NAMES_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

/** Календарная дата в московском времени, извлечённая из момента времени. */
export function moscowDateOf(instant: Date | string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error(`moscowDateOf: некорректный момент времени ${String(instant)}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** День недели ISO-даты: 1 = понедельник … 7 = воскресенье (без участия timezone среды). */
export function isoDayOfWeek(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`isoDayOfWeek: некорректная дата ${date}`);
  return parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`parseDate: некорректная дата ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isStatutoryHoliday(date: string): { holiday: boolean; name: string | null } {
  const { month, day } = parseDate(date);
  const found = STATUTORY_HOLIDAYS.find((entry) => entry.month === month && entry.day === day);
  return { holiday: found !== undefined, name: found?.name ?? null };
}

/**
 * Официальный статус дня: праздник, перенесённый выходной или рабочий день.
 * ВАЖНО: официальный статус нельзя выводить только из дня недели — переносы приходят
 * из постановлений Правительства, а непроверенные годы помечаются UNVERIFIED.
 */
export interface OfficialDayStatus {
  date: string;
  statutoryHoliday: boolean;
  holidayName: string | null;
  isCalendarWeekend: boolean;
  shiftedDayOff: boolean;
  shiftSource: string | null;
  shiftVerification: "PARTIALLY_VERIFIED" | "UNVERIFIED" | "NONE";
  workingSaturday: boolean;
  officialDayOff: boolean;
  preHolidayShortDay: boolean;
  verification: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED";
}

export function officialDayStatus(date: string): OfficialDayStatus {
  const { year } = parseDate(date);
  const holiday = isStatutoryHoliday(date);
  const dow = isoDayOfWeek(date);
  const isCalendarWeekend = dow >= 6;

  const shiftedOff = OFFICIAL_SHIFTS.find((shift) => shift.to === date) ?? null;
  const shiftedFrom = OFFICIAL_SHIFTS.find((shift) => shift.from === date) ?? null;

  const yearVerified = SHIFT_YEARS_VERIFIED.includes(year);
  const verification: OfficialDayStatus["verification"] = yearVerified ? "PARTIALLY_VERIFIED" : "UNVERIFIED";

  return {
    date,
    statutoryHoliday: holiday.holiday,
    holidayName: holiday.name,
    isCalendarWeekend,
    shiftedDayOff: shiftedOff !== null,
    shiftSource: shiftedOff?.legalAct ?? shiftedFrom?.legalAct ?? null,
    shiftVerification: shiftedOff ? shiftedOff.verified : "NONE",
    // рабочая суббота: выходной перенесён с этой даты на другую → день становится рабочим
    workingSaturday: shiftedFrom !== null && isCalendarWeekend,
    officialDayOff: holiday.holiday || isCalendarWeekend || shiftedOff !== null,
    preHolidayShortDay: PRE_HOLIDAY_SHORT_DAYS_2025.includes(date),
    verification,
  };
}

/** Ближайший официальный праздник (по ст. 112) в пределах окна поиска. */
export function nearestHoliday(date: string, window = 20): { daysTo: number | null; daysAfter: number | null; name: string | null } {
  let daysTo: number | null = null;
  let daysAfter: number | null = null;
  let name: string | null = null;
  for (let offset = 1; offset <= window; offset++) {
    const forward = addDays(date, offset);
    if (isStatutoryHoliday(forward).holiday) {
      daysTo = offset;
      name = isStatutoryHoliday(forward).name;
      break;
    }
  }
  for (let offset = 1; offset <= window; offset++) {
    const backward = addDays(date, -offset);
    if (isStatutoryHoliday(backward).holiday) {
      daysAfter = offset;
      break;
    }
  }
  return { daysTo, daysAfter, name };
}

/** Длинный выходной: последовательность ≥ 3 нерабочих (праздничных/календарных/перенесённых) дней. */
export interface LongWeekendInfo {
  inLongWeekend: boolean;
  length: number;
  start: string | null;
  end: string | null;
  position: number;
}

export function longWeekendAt(date: string, maxScan = 15): LongWeekendInfo {
  const isOff = (day: string) => officialDayStatus(day).officialDayOff;
  if (!isOff(date)) return { inLongWeekend: false, length: 0, start: null, end: null, position: 0 };

  let start = date;
  let end = date;
  for (let offset = 1; offset <= maxScan; offset++) {
    const previous = addDays(date, -offset);
    if (isOff(previous)) start = previous;
    else break;
  }
  for (let offset = 1; offset <= maxScan; offset++) {
    const next = addDays(date, offset);
    if (isOff(next)) end = next;
    else break;
  }
  const length = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const position = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  return { inLongWeekend: length >= 3, length, start, end, position };
}

/** Полный набор базовых календарных признаков дня. */
export interface CalendarFeatures {
  date: string;
  dayOfWeek: number;
  dayOfWeekName: string;
  isWeekend: boolean;
  dayOfMonth: number;
  weekOfYear: number;
  month: number;
  quarter: number;
  year: number;
  daysInMonth: number;
  isMonthStart: boolean;
  isMonthEnd: boolean;
  isQuarterStart: boolean;
  isQuarterEnd: boolean;
  isYearStart: boolean;
  isYearEnd: boolean;
  season: "winter" | "spring" | "summer" | "autumn";
  official: OfficialDayStatus;
  longWeekend: LongWeekendInfo;
  daysToHoliday: number | null;
  daysAfterHoliday: number | null;
  nearestHolidayName: string | null;
}

export function seasonOf(month: number): CalendarFeatures["season"] {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export function weekOfYear(date: string): number {
  const { year } = parseDate(date);
  const firstDay = `${year}-01-01`;
  const diff = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${firstDay}T00:00:00Z`).getTime()) / 86_400_000);
  return Math.floor(diff / 7) + 1;
}

export function calendarFeatures(date: string): CalendarFeatures {
  const { year, month, day } = parseDate(date);
  const dow = isoDayOfWeek(date);
  const holiday = nearestHoliday(date);
  const total = daysInMonth(year, month);
  return {
    date,
    dayOfWeek: dow,
    dayOfWeekName: DOW_NAMES_RU[dow - 1]!,
    isWeekend: dow >= 6,
    dayOfMonth: day,
    weekOfYear: weekOfYear(date),
    month,
    quarter: Math.floor((month - 1) / 3) + 1,
    year,
    daysInMonth: total,
    isMonthStart: day === 1,
    isMonthEnd: day === total,
    isQuarterStart: day === 1 && [1, 4, 7, 10].includes(month),
    isQuarterEnd: day === total && [3, 6, 9, 12].includes(month),
    isYearStart: month === 1 && day === 1,
    isYearEnd: month === 12 && day === 31,
    season: seasonOf(month),
    official: officialDayStatus(date),
    longWeekend: longWeekendAt(date),
    daysToHoliday: holiday.daysTo,
    daysAfterHoliday: holiday.daysAfter,
    nearestHolidayName: holiday.name,
  };
}
