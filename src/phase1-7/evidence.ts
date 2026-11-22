/**
 * Этап 1.7 — реестр свидетельств (evidence manifest).
 *
 * Каждое свидетельство — конкретный факт из ранее собранного каталога Superset
 * или из артефактов предыдущих этапов. Значения колонок не выгружаются:
 * для PII-колонок сохраняется только пометка, для остальных — короткий сэмпл.
 */
import { Catalog, loadCatalog } from "./load";
import { evId } from "./paths";

export interface EvidenceRecord {
  evidence_id: string;
  key: string;
  evidence_type: string;
  source_status: string;
  source_kind: string;
  dataset_id: number | null;
  dataset_name: string | null;
  schema: string | null;
  database: string | null;
  object: string | null;
  column: string | null;
  summary: string;
  confidence: string;
  pii: boolean;
  limitation: string | null;
  artifact: string | null;
}

/** Колонки, которые считаем потенциально персональными. */
const PII_COLUMN_RE = /(^|_)(fio|name_courier|courier|mentorfio|phone|tel|email|mail|inn|user_inn|courier_inn|passport|snils|birth|address|fio_trainee|fio_trainer|kyst_name|name_curator)(_|$)/i;

export function isPiiColumnName(name: string): boolean {
  return PII_COLUMN_RE.test(name);
}

/** Датасеты, попадающие в evidence manifest (ключевые для модели и forensic-выводов). */
export const EVIDENCE_DATASETS: number[] = [
  4732, 3466, 3035, 5799, 5797, 7775, 7802, 7712, 7713, 7006, 7027, 7119, 7024,
  5247, 5399, 5939, 7473, 7465, 7021, 7771, 7765, 7766, 7399, 6863, 7293, 2339,
  5987, 6831, 6836, 4997, 6030, 7043, 6679, 7000, 7036, 1677, 1787, 4023, 6054, 6386, 6522,
];

/** Колонки, которые обязательно должны попасть в manifest. */
export const EVIDENCE_COLUMNS: Array<[number, string]> = [
  [4732, "order_status"], [4732, "date_order"], [4732, "date_collected"], [4732, "date_delivered"],
  [4732, "date_supply_untill"], [4732, "id_order"], [4732, "shopno"], [4732, "id_tt"], [4732, "id_pool"],
  [4732, "id_courier"], [4732, "is_canceled"], [4732, "is_returned_store"], [4732, "sum_paid"], [4732, "sum_order"],
  [4732, "sla_collection_time_all"], [4732, "sla_delivery_time_all"], [4732, "sla_order_time"], [4732, "delivery_type"],
  [4732, "delivery_type_group"], [4732, "feature_tt"], [4732, "region_tt"], [4732, "name_tt"], [4732, "region_tt"],
  [3466, "order_status"], [3466, "time_ready"], [3466, "time_ready_plan"], [3466, "zone_cluster"], [3466, "id_tt"],
  [3466, "id_order"], [3466, "id_courier"], [3466, "id_pool"], [3466, "date_order"], [3466, "date_collected"],
  [3466, "date_delivered"], [3466, "is_canceled"], [3466, "is_returned_store"], [3466, "is_collection_overdue"],
  [3035, "status_name"], [3035, "is_canceled"], [3035, "is_returned_store"], [3035, "zone_cluster"],
  [7802, "id_shift"], [7802, "id_courier"],  [7802, "shopno"], [7802, "region"],
  [7802, "courier_name"], [7802, "useless_minutes"], [7802, "wait_minutes"], [7802, "assembly_minutes"],
  [7802, "shift_minutes"], [7802, "rn_shift"],
  [7712, "courier_id"], [7712, "attempt_dt"], [7712, "attempt_n"], [7712, "shift_opened"], [7712, "shift_open_time"],
  [7712, "name_tt"], [7712, "shopno"], [7712, "region_tt"],
  [7006, "id_pool"], [7006, "id_order"], [7006, "id_courier"], [7006, "id_pool_calc"], [7006, "date_pickuped"],
  [7006, "arrival_time"], [7006, "pool_size"], [7006, "fact_seq"], [7006, "plan_seq"], [7006, "cluster_id"],
  [7006, "courier_type"], [7006, "minutes_late"], [7006, "is_final"], [7006, "date_collected"], [7006, "date_delivered"],
  [7027, "id_pool"], [7027, "id_order"], [7027, "id_courier"], [7027, "arrival_time"], [7027, "date_pickuped"],
  [7027, "pool_size"], [7027, "fact_seq"], [7027, "total_pool_distance"], [7027, "flag_courier_is_newbie"],
  [7027, "date_collected"], [7027, "date_delivered"], [7027, "cluster_id"],
  [7119, "id_pool"], [7119, "id_order"], [7119, "id_courier"], [7119, "arrival_time"], [7119, "date_pickuped"],
  [7119, "pool_size"], [7119, "fact_seq"], [7119, "cluster_id"],
  [7024, "id_pool"], [7024, "pool_size"], [7024, "distance"], [7024, "plan_duration_min"], [7024, "fact_duration_min"],
  [5247, "courier_id"], [5247, "event_name"], [5247, "events_qty"], [5247, "d"], [5247, "id_tt"], [5247, "shopno"],
  [5399, "courier_id"], [5399, "event_name"], [5399, "events_qty"], [5399, "week_no"],
  [5939, "mentorid"], [5939, "mentor_at_date"], [5939, "mentorid_at_date"], [5939, "date_for_mentor"],
  [5939, "person_code"], [5939, "shift_rn_trainee"], [5939, "enough_shifts_for_mentor"], [5939, "date_start_work"],
  [7473, "id_courier"], [7473, "shift_1_profit"], [7473, "shift_5_profit"], [7473, "shift_1"], [7473, "shift_5"],
  [7473, "has_5_shifts_in_first_14d"], [7473, "trial_period_label"], [7473, "zone"], [7473, "name_curator"],
  [7465, "id_courier"], [7473, "shift_1_profit"], [7465, "zone"], [7465, "trial_period_label"],
  [7021, "shift_type"], [7021, "is_night_shift"], [7021, "time_start"], [7021, "time_end"], [7021, "id_tt"],
  [7021, "order_status"], [7021, "has_timesheet"],
  [7775, "ID"], [7775, "id_courier_type"], [7775, "job_type"], [7775, "Активный"],
  [7771, "person_code"], [7771, "fio_trainer"], [7771, "start_date"], [7771, "completiondate"],
  [7765, "id_courier"], [7765, "shift_id"], [7765, "has_order"], [7765, "dt"], [7765, "tt_name"],
  [7766, "tt_name"], [7766, "has_order"], [7766, "dt"],
  [7399, "to_zone_label"], [7399, "trans_label"], [7399, "curator"], [7399, "name_tt"],
  [6863, "ZoneName"], [6863, "GeneralZone"], [6863, "id_tt"], [6863, "geo"], [6863, "isActive"], [6863, "date_upd"],
  [7293, "zone"], [7293, "balance"], [7293, "date"],
  [2339, "object_id"], [2339, "prop"], [2339, "type"], [2339, "comment"], [2339, "id_order"], [2339, "date_supply"],
  [5987, "date_update"], [4997, "feature_tt"], [5799, "feature_tt"], [5799, "order_status"],
  [5797, "id_courier"], [5797, "zone"], [5797, "zone_transition_type"], [5797, "trial_period_label"],
  [5797, "is_banned"], [5797, "active"], [5797, "name_curator"], [5797, "region_name"], [5797, "name_tt"],
  [5797, "first_order_date"], [5797, "last_order_date"], [5797, "date_dismissed"], [5797, "event_hiring"],
  [5797, "disabling_reason"], [5797, "inactivity_zone"], [5797, "fio"], [5797, "phone"], [5797, "inn"],
  [7775, "ID"], [7775, "id_courier_type"], [7775, "job_type"], [7775, "Активный"], [7775, "Курьер"],
  [7775, "Телефон"], [7775, "Тип занятости"], [7775, "Тип курьера"],
  [7765, "id_courier"], [7765, "shift_id"], [7765, "has_order"], [7765, "has_plan"], [7765, "tt_name"],
  [7765, "region"], [7765, "dt"], [7765, "week_start"], [7765, "source"],
  [7766, "tt_name"], [7766, "has_limits"], [7766, "has_record"], [7766, "dt"], [7766, "region"],
  [7399, "to_zone_label"], [7399, "order_dt"], [7399, "region_name"], [7399, "pred"], [7399, "trans_label"],
  [7036, "curator_couriers"], [7036, "leader_curators"], [7036, "district"], [7036, "region_name"],
  [7036, "store_format"], [7036, "is_dark_store"], [7036, "is_grey_store"], [7036, "latitude"],
  [7036, "longitude"], [7036, "cluster_name"], [7036, "ТТ"], [7036, "Регион"], [7036, "city"],
  [1677, "amount"], [1677, "Дата начисления"], [1677, "Причина начисления бонусов"], [1677, "name_TT"],
  [1677, "FullName"], [1677, "Manager"], [1677, "Position"],
  [1787, "amount"], [1787, "id_order"], [1787, "type_award"], [1787, "Дата начисления"], [1787, "name_TT"],
  [1787, "TTfeature"],
  [4023, "Количество_доставленных_заказов"], [4023, "Количество_жалоб"], [4023, "Количество_опозданий"],
  [4023, "Рейтинг"], [4023, "ТТ"], [4023, "ФИО_курьера"],
  [7000, "zone_cluster"],
  [7771, "person_code"], [7771, "fio_trainee"], [7771, "fio_trainer"], [7771, "date_start_work"],
  [7771, "completiondate"], [7771, "completionstatus"], [7771, "title_track"], [7771, "store_name"],
  [7771, "enough_shifts"], [7771, "shifts_qty"], [7771, "current_stage"],
  [6054, "mentorid"], [6054, "mentor_at_date"], [6054, "date_for_mentor"], [6054, "shift_rn_trainee"],
  [6054, "shifts_qty"], [6054, "event_type"], [6054, "date_dismissed"], [6054, "role"],
  [6054, "position_name"], [6054, "tt_name"], [6054, "region_name"],
  [6386, "shift_rn_trainee"], [6386, "shifts_qty"], [6386, "event_type"], [6386, "role"],
  [6386, "type_emp"], [6386, "tt_name"], [6386, "region_name"],
  [6522, "curator_soo_chef_name"], [6522, "green_cnt"], [6522, "red_cnt"], [6522, "gray_cnt"], [6522, "total_cnt"],
  [7043, "id_sbor"], [7043, "collect_min"], [7043, "current_downtime_min"], [7043, "schedule_min_by_timesheet"],
  [7043, "id_tt"], [7043, "name_tt"], [7043, "region_tt"], [7043, "shopno"], [7043, "collected_date"],
  [6679, "event_category"], [6679, "event_inf"], [6679, "events"], [6679, "cnt"], [6679, "id_courier"],
  [6679, "dt_supply"], [6679, "region_tt"], [6679, "name_tt"], [6679, "job_type_name"],
  [7712, "shift_opened"], [7712, "name_tt"], [7712, "job_type_name"], [7712, "courier_type_name"],
  [7713, "id_name"], [7713, "attempt_dt"], [7713, "photo_kind"], [7713, "name_tt"],
  [4997, "time_ready"], [4997, "time_ready_plan"], [4997, "order_status"], [4997, "date_collected"],
  [4997, "date_delivered"], [4997, "id_courier"], [4997, "id_tt"], [4997, "id_pool"], [4997, "courier"],
  [4997, "is_canceled"], [4997, "geo"], [4997, "region_tt"], [4997, "name_tt"], [4997, "shopno"],
  [5799, "time_ready"], [5799, "time_ready_plan"], [5799, "date_collected"], [5799, "date_delivered"],
  [5799, "id_courier"], [5799, "id_tt"], [5799, "id_pool"], [5799, "geo"], [5799, "region_tt"],
  [5799, "name_tt"], [5799, "shopno"], [5799, "is_canceled"], [5799, "is_returned_store"],
  [6831, "order_status"], [6831, "time_ready"], [6831, "time_ready_plan"], [6831, "id_tt"], [6831, "id_pool"],
  [6831, "id_courier"], [6831, "geo"], [6831, "region_tt"], [6831, "name_tt"], [6831, "shopno"],
  [6831, "courier"], [6831, "delivery_type_group"], [6831, "feature_tt"], [6831, "is_canceled"],
  [6836, "order_status"], [6836, "time_ready"], [6836, "time_ready_plan"], [6836, "id_tt"], [6836, "id_pool"],
  [6836, "id_courier"], [6836, "geo"], [6836, "region_tt"], [6836, "name_tt"], [6836, "shopno"],
  [6836, "courier"], [6836, "delivery_type_group"], [6836, "feature_tt"], [6836, "is_canceled"],
  [6836, "cluster_name"], [6836, "total_orders"],
  [6030, "status_name"], [6030, "date_delivered"], [6030, "date_supply"], [6030, "delivery_type_group"],
  [6030, "feature_tt"], [6030, "name_tt"], [6030, "region_tt"], [6030, "shopno"],
  [3466, "order_status"], [3466, "date_order"], [3466, "date_collected"], [3466, "date_delivered"],
  [3466, "date_supply"], [3466, "id_order"], [3466, "id_tt"], [3466, "shopno"], [3466, "is_canceled"],
  [3466, "sum_paid"], [3466, "sum_order"], [3466, "courier"], [3466, "delivery_type"], [3466, "region_tt"],
  [3466, "name_tt"], [3466, "geo"], [3466, "id_pool"], [3466, "id_courier"], [3466, "time_ready"],
  [3466, "time_ready_plan"], [3466, "date_supply_untill"], [3466, "sla_order_time"], [3466, "sla_delivery_time_all"],
  [3466, "sla_collection_time_all"], [3466, "feature_tt"], [3466, "delivery_type_group"], [3466, "id_status"],
  [4732, "order_status"], [4732, "date_order"], [4732, "date_collected"], [4732, "date_delivered"],
  [4732, "id_order"], [4732, "id_tt"], [4732, "shopno"], [4732, "is_canceled"], [4732, "sum_paid"],
  [4732, "courier"], [4732, "delivery_type"], [4732, "region_tt"], [4732, "name_tt"], [4732, "geo"],
  [4732, "id_pool"], [4732, "id_courier"], [4732, "delivery_type_group"], [4732, "feature_tt"],
  [4732, "partner_type"], [4732, "id_partner"], [4732, "id_status"], [4732, "date_supply_untill"],
  [6831, "date_order"], [6831, "date_collected"], [6831, "date_delivered"], [6831, "date_supply"],
  [6831, "sum_paid"], [6831, "sum_order"], [6831, "sla_order_time"], [6831, "sla_delivery_time_all"],
  [6831, "sla_collection_time_all"], [6831, "id_order"], [6831, "id_status"],
  [6836, "date_order"], [6836, "date_collected"], [6836, "date_delivered"], [6836, "date_supply"],
  [6836, "sum_paid"], [6836, "sum_order"], [6836, "sla_order_time"], [6836, "sla_delivery_time_all"],
  [6836, "sla_collection_time_all"], [6836, "id_order"], [6836, "id_status"],
  [4997, "date_order"], [4997, "date_supply"], [4997, "sum_paid"], [4997, "sum_order"], [4997, "delivery_type"],
  [4997, "sla_order_time"], [4997, "sla_delivery_time_all"], [4997, "sla_collection_time_all"], [4997, "id_status"],
  [5799, "date_order"], [5799, "date_supply"], [5799, "sum_paid"], [5799, "sum_order"], [5799, "delivery_type"],
  [5799, "sla_order_time"], [5799, "sla_delivery_time_all"], [5799, "sla_collection_time_all"], [5799, "id_status"],
];

function tableNames(sql: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:from|join)\s+([A-Za-z_][\w.]*\.[A-Za-z_][\w.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.add(m[1].toLowerCase());
  return [...out].slice(0, 12);
}

export interface EvidenceIndex {
  records: EvidenceRecord[];
  byKey: Map<string, EvidenceRecord>;
}

export function buildEvidence(cat: Catalog): EvidenceIndex {
  const records: EvidenceRecord[] = [];
  const byKey = new Map<string, EvidenceRecord>();
  let seq = 0;

  const push = (rec: Omit<EvidenceRecord, "evidence_id">): void => {
    seq += 1;
    const full: EvidenceRecord = { evidence_id: evId(seq), ...rec };
    records.push(full);
    byKey.set(full.key, full);
  };

  const dsIds = new Set<number>(EVIDENCE_DATASETS);
  for (const [id] of EVIDENCE_COLUMNS) dsIds.add(id);

  for (const id of dsIds) {
    const ds = cat.datasetsDetailById.get(id);
    const inv = cat.inventoryById.get(id);
    if (!ds) {
      push({
        key: `ds:${id}`,
        evidence_type: "NOT_VERIFIABLE",
        source_status: "NOT_VERIFIABLE",
        source_kind: "SUPERSET_DATASET",
        dataset_id: id,
        dataset_name: inv?.name ?? null,
        schema: null,
        database: null,
        object: null,
        column: null,
        summary: `Датасет ${id} присутствует в списке, но детали (SQL, колонки) не загружены — доступно только имя и домен.`,
        confidence: "LOW",
        pii: false,
        limitation: "Детали датасета не загружались на этапе 1.6.2 (только P0/P1).",
        artifact: "data/snapshots/phase-01-6-2/datasets.list.json",
      });
      continue;
    }
    const tables = tableNames(ds.sql ?? "");
    const hasSql = Boolean(ds.sql && ds.sql.length > 0);
    push({
      key: `ds:${id}`,
      evidence_type: hasSql ? "SQL_DEFINITION" : "METADATA_ONLY",
      source_status: "FOUND_IN_SUPERSET_SQL",
      source_kind: "SUPERSET_DATASET",
      dataset_id: id,
      dataset_name: ds.name,
      schema: ds.schema ?? null,
      database: inv?.database_name ?? null,
      object: tables.length > 0 ? tables.join(", ") : null,
      column: null,
      summary: `Датасет ${id} «${ds.name}» (${ds.schema ?? "schema?"}): ${ds.columns.length} колонок, ${ds.metrics.length} метрик, SQL ${hasSql ? `${(ds.sql ?? "").length} символов` : "не задан"}${tables.length ? `; таблицы: ${tables.join(", ")}` : ""}.`,
      confidence: "HIGH",
      pii: false,
      limitation: "Наличие SQL и колонок не подтверждает наполнение и актуальность данных.",
      artifact: "data/snapshots/phase-01-6-2/datasets.detail.json",
    });
  }

  for (const [id, colName] of EVIDENCE_COLUMNS) {
    const ds = cat.datasetsDetailById.get(id);
    if (!ds) continue;
    const col = ds.columns.find((c) => c.name === colName);
    if (!col) continue;
    const pii = isPiiColumnName(colName);
    push({
      key: `col:${id}:${colName}`,
      evidence_type: "METADATA_ONLY",
      source_status: "FOUND_IN_SUPERSET_METADATA",
      source_kind: "SUPERSET_COLUMN",
      dataset_id: id,
      dataset_name: ds.name,
      schema: ds.schema ?? null,
      database: null,
      object: `${ds.schema ?? "?"}.${ds.name}`,
      column: colName,
      summary: `Колонка ${colName} в датасете ${id}: тип ${col.type ?? "не указан"}${col.is_dttm ? ", временная" : ""}${col.verbose_name ? `, verbose_name «${col.verbose_name}»` : ""}.`,
      confidence: "HIGH",
      pii,
      limitation: pii ? "Потенциально персональные данные: значения не выгружались." : "Тип и наличие колонки не подтверждают её значения.",
      artifact: "data/snapshots/phase-01-6-2/datasets.detail.json",
    });
  }

  // Значения из фильтров и SQL-литералов (только для не-PII колонок).
  for (const cv of cat.columnValues) {
    if (!cv.top_values || cv.top_values.length === 0) continue;
    if (!dsIds.has(Number(cv.dataset_id))) continue;
    if (isPiiColumnName(cv.column_name)) continue;
    const isFilter = cv.source === "dashboard_filter" || cv.source === "dashboard_native_filter";
    const key = `${isFilter ? "fv" : "sql"}:${cv.dataset_id}:${cv.column_name}`;
    if (byKey.has(key)) continue;
    push({
      key,
      evidence_type: isFilter ? "FILTER_VALUES" : "SQL_DERIVED",
      source_status: isFilter ? "FOUND_IN_FILTER" : "FOUND_AS_SQL_DERIVED",
      source_kind: isFilter ? "SUPERSET_DASHBOARD_FILTER" : "SUPERSET_DATASET_SQL",
      dataset_id: Number(cv.dataset_id),
      dataset_name: cv.dataset_name,
      schema: null,
      database: null,
      object: null,
      column: cv.column_name,
      summary: `Колонка ${cv.column_name} (${cv.dataset_id}): ${cv.top_values.length} значений из ${isFilter ? "native-фильтра дашборда" : "SQL-определения датасета"}; примеры: ${cv.top_values.slice(0, 5).map((v) => String(v.value)).join(", ")}.`,
      confidence: "MEDIUM",
      pii: false,
      limitation: isFilter
        ? "Значение по умолчанию/список фильтра, а не распределение данных."
        : "Литерал в SQL-определении, а не факт наличия значения в данных.",
      artifact: "reports/phase-01-6-2/column_values.json",
    });
  }

  // Relationship candidates.
  cat.relationships.slice(0, 400).forEach((r, idx) => {
    push({
      key: `rel:${idx + 1}`,
      evidence_type: "SQL_JOIN_CANDIDATE",
      source_status: "FOUND_IN_SUPERSET_SQL",
      source_kind: "RELATIONSHIP_CANDIDATE",
      dataset_id: Number(r.left_dataset),
      dataset_name: r.left_dataset_name,
      schema: null,
      database: null,
      object: `${r.left_dataset}.${r.left_field} → ${r.right_dataset}.${r.right_field}`,
      column: r.left_field,
      summary: `Кандидат связи ${r.left_dataset}.${r.left_field} = ${r.right_dataset}.${r.right_field} (${r.relationship_type}); совпадение имён не доказывает FK.`,
      confidence: "LOW",
      pii: false,
      limitation: "Совпадение имён колонок и JOIN в SQL не подтверждают FK и целостность.",
      artifact: "reports/phase-01-6-2/relationship_candidates.csv",
    });
  });

  // Ограничения доступа.
  push({
    key: "access:sqllab",
    evidence_type: "NOT_VERIFIABLE",
    source_status: "NOT_VERIFIABLE",
    source_kind: "ACCESS_LIMITATION",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "/api/v1/sqllab/*",
    column: null,
    summary: "SQL Lab и /api/v1/query/ вернули 403: фактические значения из данных получить нельзя.",
    confidence: "HIGH",
    pii: false,
    limitation: "Блокер доступа: SQL Lab запрещён для учётной записи агента.",
    artifact: "reports/phase-01-6-2/superset_access_matrix.json",
  });
  push({
    key: "access:chart_data",
    evidence_type: "NOT_VERIFIABLE",
    source_status: "NOT_VERIFIABLE",
    source_kind: "ACCESS_LIMITATION",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "/api/v1/chart/data",
    column: null,
    summary: "Chart data вернул 401: распределения и агрегаты чартов недоступны.",
    confidence: "HIGH",
    pii: false,
    limitation: "Блокер доступа: chart data запрещён.",
    artifact: "reports/phase-01-6-2/superset_access_matrix.json",
  });
  push({
    key: "access:databases",
    evidence_type: "NOT_VERIFIABLE",
    source_status: "NOT_VERIFIABLE",
    source_kind: "ACCESS_LIMITATION",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "/api/v1/database/",
    column: null,
    summary: "Список баз данных пуст (count=0): физические БД и их владельцы не видны.",
    confidence: "HIGH",
    pii: false,
    limitation: "Блокер доступа: нет видимых баз данных.",
    artifact: "reports/phase-01-6-2/superset_access_matrix.json",
  });

  // Артефакты предыдущих этапов.
  push({
    key: "prior:1.5:model",
    evidence_type: "METADATA_ONLY",
    source_status: "FOUND_IN_SUPERSET_METADATA",
    source_kind: "STAGE_ARTIFACT",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "docs/phase-01-5/04_logical_data_model.md",
    column: null,
    summary: "Логическая модель 1.5: 25 таблиц, контексты, зерно, PK, владельцы.",
    confidence: "HIGH",
    pii: false,
    limitation: "Проектная модель, не подтверждённая физическими источниками.",
    artifact: "docs/phase-01-5/04_logical_data_model.md",
  });
  push({
    key: "prior:1.5:mapping",
    evidence_type: "METADATA_ONLY",
    source_status: "FOUND_IN_SUPERSET_METADATA",
    source_kind: "STAGE_ARTIFACT",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "docs/phase-01-5/superset-to-domain-mapping.json",
    column: null,
    summary: "60 сопоставлений domain_table/domain_column → superset_dataset/field с уровнем evidence.",
    confidence: "MEDIUM",
    pii: false,
    limitation: "Часть сопоставлений выведена по смыслу и требует подтверждения.",
    artifact: "docs/phase-01-5/superset-to-domain-mapping.json",
  });
  push({
    key: "prior:1.5:decisions",
    evidence_type: "BUSINESS_REQUIREMENT",
    source_status: "NOT_IN_SCOPE",
    source_kind: "STAGE_ARTIFACT",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "docs/phase-01-5/business_decisions_register.json",
    column: null,
    summary: "24 бизнес-решения BD-001…BD-024 со статусами и владельцами.",
    confidence: "HIGH",
    pii: false,
    limitation: "Решения — требования бизнеса, а не свидетельства источников.",
    artifact: "docs/phase-01-5/business_decisions_register.json",
  });
  push({
    key: "prior:1.6:forensics",
    evidence_type: "METADATA_ONLY",
    source_status: "FOUND_IN_SUPERSET_SQL",
    source_kind: "STAGE_ARTIFACT",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "reports/phase-01-6/evidence/sql_forensics.md",
    column: null,
    summary: "Forensic-разбор SQL: отсутствие time_ready/date_for_mentor в SQL, физические таблицы смен, 7802, 7021.",
    confidence: "HIGH",
    pii: false,
    limitation: "Разбор по SQL-определениям, без выполнения запросов.",
    artifact: "reports/phase-01-6/evidence/sql_forensics.md",
  });
  push({
    key: "prior:1.6.2:validation",
    evidence_type: "METADATA_ONLY",
    source_status: "FOUND_IN_SUPERSET_METADATA",
    source_kind: "STAGE_ARTIFACT",
    dataset_id: null,
    dataset_name: null,
    schema: null,
    database: null,
    object: "reports/phase-01-6-2/final_validation.json",
    column: null,
    summary: "Валидация 1.6.2: PASS_WITH_BLOCKERS, 15/15 проверок, PII 0.",
    confidence: "HIGH",
    pii: false,
    limitation: "Проверки охватывают артефакты 1.6.2, а не данные источников.",
    artifact: "reports/phase-01-6-2/final_validation.json",
  });

  return { records, byKey };
}

export function evidenceRef(ev: EvidenceRecord): string {
  return ev.evidence_id;
}
