/**
 * Stage 3.4.2 — каталог календарных признаков с оценкой доступности на forecast origin.
 */

export type FeatureStatus = "CANDIDATE" | "CONDITIONAL" | "BLOCKED" | "EXCLUDED";
export type LeakageRisk = "none" | "low" | "medium" | "high";

export interface CalendarFeatureSpec {
  feature_name: string;
  category: string;
  definition: string;
  effective_date_rule: string;
  source: string;
  available_at: string;
  known_in_advance: boolean;
  revision_policy: string;
  leakage_risk: LeakageRisk;
  allowed_horizon: number[];
  status: FeatureStatus;
  rationale: string;
}

const HORIZONS = [1, 3, 7, 14];

export const FEATURE_CATALOG: readonly CalendarFeatureSpec[] = [
  {
    feature_name: "day_of_week",
    category: "basic_calendar",
    definition: "номер дня недели 1…7 (ISO) и его название",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из даты",
    available_at: "всегда известен заранее",
    known_in_advance: true,
    revision_policy: "не пересматривается",
    leakage_risk: "none",
    allowed_horizon: HORIZONS,
    status: "CANDIDATE",
    rationale: "базовый признак; распределение по дням недели проверено описательно",
  },
  {
    feature_name: "is_weekend",
    category: "weekend",
    definition: "суббота или воскресенье по календарю",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из даты",
    available_at: "всегда известен заранее",
    known_in_advance: true,
    revision_policy: "не пересматривается",
    leakage_risk: "none",
    allowed_horizon: HORIZONS,
    status: "CANDIDATE",
    rationale: "различие рабочих и выходных дней наблюдаемо, но переносы делают признак неполным без производственного календаря",
  },
  {
    feature_name: "month / quarter / week_of_year",
    category: "basic_calendar",
    definition: "номер месяца, квартала, недели года",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из даты",
    available_at: "всегда известен заранее",
    known_in_advance: true,
    revision_policy: "не пересматривается",
    leakage_risk: "none",
    allowed_horizon: HORIZONS,
    status: "CANDIDATE",
    rationale: "описательная сезонность наблюдаема; для утверждений о многолетней сезонности истории недостаточно",
  },
  {
    feature_name: "month_boundary_flags",
    category: "basic_calendar",
    definition: "начало/конец месяца, квартала, года; число дней в месяце",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из даты",
    available_at: "всегда известен заранее",
    known_in_advance: true,
    revision_policy: "не пересматривается",
    leakage_risk: "none",
    allowed_horizon: HORIZONS,
    status: "CANDIDATE",
    rationale: "требует проверки на данных; границы периода могут совпадать с праздниками",
  },
  {
    feature_name: "is_statutory_holiday",
    category: "official_holiday",
    definition: "нерабочий праздничный день по ст. 112 ТК РФ (1–6, 8 января, 7 января, 23 февраля, 8 марта, 1 мая, 9 мая, 12 июня, 4 ноября)",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "Трудовой кодекс РФ, ст. 112 (перечень постоянный)",
    available_at: "известен заранее (даты фиксированы законом)",
    known_in_advance: true,
    revision_policy: "перечень может меняться федеральным законом; требуется периодическая сверка",
    leakage_risk: "low",
    allowed_horizon: HORIZONS,
    status: "CONDITIONAL",
    rationale: "даты подтверждены вторичным источником со ссылкой на ст. 112 ТК РФ; официальный первоисточник не проверялся",
  },
  {
    feature_name: "official_day_off / working_saturday",
    category: "long_weekend",
    definition: "нерабочий день с учётом переносов; рабочая суббота после переноса",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "постановления Правительства РФ о переносе выходных",
    available_at: "с момента официальной публикации постановления (обычно осенью предыдущего года)",
    known_in_advance: true,
    revision_policy: "постановление публикуется один раз; возможны поздние изменения",
    leakage_risk: "medium",
    allowed_horizon: HORIZONS,
    status: "CONDITIONAL",
    rationale: "для 2025 переносы подтверждены вторичным источником; 2024 и 2026 не проверялись → UNVERIFIED",
  },
  {
    feature_name: "days_to_holiday / days_after_holiday",
    category: "holiday_proximity",
    definition: "число дней до ближайшего и после последнего праздника по ст. 112",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из перечня праздников",
    available_at: "известен заранее",
    known_in_advance: true,
    revision_policy: "зависит от перечня праздников",
    leakage_risk: "low",
    allowed_horizon: HORIZONS,
    status: "CONDITIONAL",
    rationale: "эффект близости праздника описательно проверяется; требует подтверждения на большем числе периодов",
  },
  {
    feature_name: "long_weekend_id / position_in_long_weekend",
    category: "long_weekend",
    definition: "идентификатор длинного выходного (≥ 3 нерабочих дней) и позиция дня внутри него",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "производственный календарь (зависит от переносов)",
    available_at: "с момента публикации постановления о переносах",
    known_in_advance: true,
    revision_policy: "зависит от постановлений",
    leakage_risk: "medium",
    allowed_horizon: HORIZONS,
    status: "CONDITIONAL",
    rationale: "требует подтверждённых переносов по всем годам истории",
  },
  {
    feature_name: "season",
    category: "seasonality",
    definition: "сезон: зима (12–2), весна (3–5), лето (6–8), осень (9–11)",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "вычисляется из даты",
    available_at: "известен заранее",
    known_in_advance: true,
    revision_policy: "не пересматривается",
    leakage_risk: "none",
    allowed_horizon: HORIZONS,
    status: "CANDIDATE",
    rationale: "доступно 2 неполных года: сезонность описательна, но не подтверждена статистически",
  },
  {
    feature_name: "temperature / precipitation / snow / ice / extreme_heat / extreme_cold",
    category: "weather",
    definition: "метеорологические показатели Москвы",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "Росгидромет, официальные метеослужбы (не подключены)",
    available_at: "фактическая погода — только после дня; прогноз погоды — с ограниченной заблаговременностью",
    known_in_advance: false,
    revision_policy: "фактические наблюдения уточняются; прогнозы пересматриваются многократно",
    leakage_risk: "high",
    allowed_horizon: [],
    status: "BLOCKED",
    rationale: "без подтверждённого источника прогноза погоды на дату origin использование приведёт к утечке будущего",
  },
  {
    feature_name: "school_holiday",
    category: "school_calendar",
    definition: "школьные каникулы Москвы",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "официальные документы образовательных организаций Москвы (не подключены)",
    available_at: "даты публикуются до начала учебного периода",
    known_in_advance: true,
    revision_policy: "различаются по школам; рекомендации и фактические даты не совпадают",
    leakage_risk: "medium",
    allowed_horizon: [],
    status: "CONDITIONAL",
    rationale: "требуется официальный источник по годам истории; без него — только гипотеза",
  },
  {
    feature_name: "city_event / road_closure / mass_departure",
    category: "city_events",
    definition: "городские мероприятия, перекрытия, массовый отъезд жителей",
    effective_date_rule: "календарная дата в Europe/Moscow",
    source: "официальные ресурсы Москвы (не подключены)",
    available_at: "анонсы известны заранее, но полнота и точность не гарантированы",
    known_in_advance: false,
    revision_policy: "события могут отменяться и переноситься",
    leakage_risk: "high",
    allowed_horizon: [],
    status: "BLOCKED",
    rationale: "нет подтверждённого источника и доказательства влияния на доставку конкретного магазина",
  },
];

export const CATEGORY_SUMMARY: ReadonlyArray<{ category: string; example: string; status: FeatureStatus }> = [
  { category: "basic_calendar", example: "day_of_week, month, month_boundary_flags", status: "CANDIDATE" },
  { category: "weekend", example: "is_weekend", status: "CANDIDATE" },
  { category: "official_holiday", example: "is_statutory_holiday", status: "CONDITIONAL" },
  { category: "holiday_proximity", example: "days_to_holiday", status: "CONDITIONAL" },
  { category: "long_weekend", example: "long_weekend_id, working_saturday", status: "CONDITIONAL" },
  { category: "seasonality", example: "season, month", status: "CANDIDATE" },
  { category: "weather", example: "temperature, precipitation", status: "BLOCKED" },
  { category: "school_calendar", example: "school_holiday", status: "CONDITIONAL" },
  { category: "city_events", example: "city_event", status: "BLOCKED" },
];

export interface SourceRecord {
  name: string;
  url: string;
  type: string;
  years: string;
  features: string;
  published: string;
  limitations: string;
  verification: "VERIFIED" | "PARTIALLY_VERIFIED" | "NOT_CHECKED";
}

export const SOURCE_REGISTRY: readonly SourceRecord[] = [
  {
    name: "Трудовой кодекс РФ, статья 112",
    url: "https://www.consultant.ru/document/cons_doc_LAW_34683/",
    type: "официальный (текст закона, доступен через вторичный ресурс)",
    years: "постоянный перечень",
    features: "is_statutory_holiday",
    published: "действующая редакция",
    limitations: "перечень может изменяться федеральным законом; проверялся текст через вторичный ресурс",
    verification: "PARTIALLY_VERIFIED",
  },
  {
    name: "Постановление Правительства РФ от 04.10.2024 N 1335 «О переносе выходных дней в 2025 году»",
    url: "https://www.consultant.ru/document/cons_doc_LAW_487367/",
    type: "официальный акт (ссылка получена со вторичного ресурса)",
    years: "2025",
    features: "official_day_off, working_saturday, long_weekend_id",
    published: "04.10.2024",
    limitations: "первоисточник publication.pravo.gov.ru не проверялся",
    verification: "PARTIALLY_VERIFIED",
  },
  {
    name: "Постановления Правительства РФ о переносе выходных дней 2024 и 2026",
    url: "http://government.ru/docs/",
    type: "официальный",
    years: "2024, 2026",
    features: "official_day_off, working_saturday",
    published: "не установлено",
    limitations: "в рамках этапа не проверялись → соответствующие дни помечены UNVERIFIED",
    verification: "NOT_CHECKED",
  },
  {
    name: "КонсультантПлюс, производственный календарь 2025",
    url: "https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2025/",
    type: "вторичный",
    years: "2025",
    features: "сверка праздников, переносов, сокращённых дней",
    published: "актуальная версия страницы",
    limitations: "неофициальный агрегатор; требуется подтверждение по первоисточнику",
    verification: "PARTIALLY_VERIFIED",
  },
  {
    name: "Росгидромет (погодные данные)",
    url: "https://www.meteorf.gov.ru/",
    type: "официальный",
    years: "не подключён",
    features: "temperature, precipitation (не загружались)",
    published: "—",
    limitations: "на этапе не использовался: прогноз погоды на дату origin недоступен без отдельного контракта",
    verification: "NOT_CHECKED",
  },
  {
    name: "Официальные ресурсы Москвы (школьные каникулы, городские события)",
    url: "https://www.mos.ru/",
    type: "официальный",
    years: "не подключён",
    features: "school_holiday, city_event (не загружались)",
    published: "—",
    limitations: "даты каникул различаются по школам; события требуют географической привязки",
    verification: "NOT_CHECKED",
  },
];
