/**
 * Чтение артефактов выгрузки и плана мероприятий.
 * Любое отклонение структуры — контролируемая ошибка, а не молчаливый пропуск данных.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseCsv } from "../reconciliation/normalizer";

export interface ArtifactRow {
  date: string;
  slice_id: number;
  dataset_id: number | null;
  viz_type: string;
  dimension_1: string;
  dimension_2: string;
  metric: string;
  metric_kind: string;
  value: number | null;
  value_raw: string;
}

export interface RunArtifacts {
  dir: string;
  manifest: any;
  quality: any;
  /** длинный формат наблюдений — источник строк daily_metrics */
  observations: ArtifactRow[];
  /** широкий формат агрегатов (19 колонок) — хранится как сырой артефакт и не разбирается в наблюдения */
  aggregate: Array<Record<string, string>>;
}

export interface PlanItem {
  ordinal: number;
  day: string;
  time: string;
  task: string;
  responsible: string;
  controller: string;
  expected_result: string;
  risk: string;
  mitigation: string;
}

const OBSERVATION_COLUMNS = ["date", "slice_id", "dimension_1", "dimension_2", "metric", "metric_kind", "value"];

function rowsToObjects(header: string[], rows: string[][]): Array<Record<string, string>> {
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function parseNumber(raw: string): number | null {
  if (raw === "" || raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Читает каталог выгрузки. `observations_7745.csv` обязателен, `aggregate_7745.csv` — по наличию.
 * Манифест и quality обязательны: без них невозможно проставить провенанс и статусы.
 */
export async function readRunArtifacts(runDir: string): Promise<RunArtifacts> {
  const dir = resolve(runDir);

  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const quality = JSON.parse(await readFile(join(dir, "quality.json"), "utf8"));
  if (!manifest || typeof manifest !== "object") throw new Error(`${dir}: manifest.json не объект`);
  if (!Array.isArray(quality?.requests)) throw new Error(`${dir}: quality.json без массива requests`);

  const readLongCsv = async (file: string): Promise<{ header: string[]; rows: string[][] }> => {
    const { header, rows } = parseCsv(await readFile(join(dir, file), "utf8"));
    for (const column of OBSERVATION_COLUMNS) {
      if (!header.includes(column)) throw new Error(`${dir}/${file}: нет обязательной колонки ${column}`);
    }
    return { header, rows };
  };

  const observationsRaw = await readLongCsv("observations_7745.csv");
  const observations = rowsToObjects(observationsRaw.header, observationsRaw.rows).map((r) => toArtifactRow(r, `${dir}/observations_7745.csv`));

  // агрегатный CSV — широкий формат: разбираем как есть, в наблюдения не превращаем
  let aggregate: Array<Record<string, string>> = [];
  try {
    const aggregateRaw = parseCsv(await readFile(join(dir, "aggregate_7745.csv"), "utf8"));
    aggregate = rowsToObjects(aggregateRaw.header, aggregateRaw.rows);
  } catch (error) {
    if (!String(error).includes("ENOENT")) throw error;
  }

  return { dir, manifest, quality, observations, aggregate };
}

function toArtifactRow(record: Record<string, string>, where: string): ArtifactRow {
  const sliceId = Number(record.slice_id);
  if (!Number.isFinite(sliceId)) throw new Error(`${where}: некорректный slice_id «${record.slice_id}»`);
  const metric = (record.metric ?? "").trim();
  if (!metric) throw new Error(`${where}: пустая метрика`);
  const date = (record.date ?? "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${where}: дата не в ISO «${date}»`);
  return {
    date,
    slice_id: sliceId,
    dataset_id: record.dataset_id === "" || record.dataset_id == null ? null : Number(record.dataset_id),
    viz_type: record.viz_type ?? "",
    dimension_1: record.dimension_1 ?? "",
    dimension_2: record.dimension_2 ?? "",
    metric,
    metric_kind: record.metric_kind ?? "",
    value: parseNumber(record.value ?? ""),
    value_raw: record.value ?? "",
  };
}

/**
 * Читает план мероприятий. Файл в CP1251 с разделителем «;» —
 * декодируем явно, чтобы не зависеть от локали терминала.
 */
export async function readPlan(path: string): Promise<PlanItem[]> {
  const bytes = await readFile(path);
  const text = new TextDecoder("windows-1251").decode(bytes);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const dataRows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const header = dataRows.shift();
  if (!header) throw new Error(`${path}: файл плана пуст`);
  let lastDay = "";
  return dataRows.map((r, index) => {
    const day = (r[0] ?? "").trim() || lastDay;
    lastDay = day;
    return {
      ordinal: index + 1,
      day,
      time: (r[1] ?? "").trim(),
      task: (r[2] ?? "").trim(),
      responsible: (r[3] ?? "").trim(),
      controller: (r[4] ?? "").trim(),
      expected_result: (r[5] ?? "").trim(),
      risk: (r[6] ?? "").trim(),
      mitigation: (r[7] ?? "").trim(),
    };
  });
}
