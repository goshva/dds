/**
 * Нормализация выгрузки Superset для сверки.
 *
 * Читает manifest.json, quality.json и observations_7745.csv из каталога выгрузки и превращает
 * их в набор наблюдений с ключом (shop_no, date, slice_id, dimension_1, dimension_2, metric).
 * Версия преобразования в ключ не входит: она учитывается отдельно (см. comparison.ts).
 *
 * Маскирование: старая выгрузка хранит измерения в замаскированном виде (`<ФИО>`), новая — «сырые».
 * Поэтому по умолчанию обе стороны приводятся к одному виду тем же маскировщиком, что и сборщик,
 * а исходный текст измерений сохраняется, чтобы отдельно оценить эффект маскирования.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { redactText } from "../../../tools/redact-pii";
import type { NormalizedObservation, NormalizedRun, QualitySnapshot } from "./types";

export interface LoadRunOptions {
  /** приводить измерения обеих сторон к замаскированному виду (по умолчанию true) */
  maskDimensions?: boolean;
  /** имя файла наблюдений */
  observationsFile?: string;
}

/** Префикс ключа для строк «итог за период» (пустая дата). */
export const TOTAL_PREFIX = "TOTAL";

const MASK_PLACEHOLDER = /</;

/** Минимальный CSV-парсер (RFC 4180: кавычки, удвоенные кавычки, переводы строк внутри поля). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
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
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return { header, rows: rows.filter((r) => r.some((c) => c !== "")) };
}

function toObjects(header: string[], rows: string[][]): Array<Record<string, string>> {
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function parseNumber(raw: string): number | null {
  if (raw === "" || raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeKey(parts: NormalizedObservation["parts"], isTotal: boolean): string {
  const date = isTotal ? TOTAL_PREFIX : parts.date;
  return [parts.shop_no, date, parts.slice_id, parts.dimension_1, parts.dimension_2, parts.metric].join("\u0001");
}

/** Читает quality.json и возвращает снимок по каждому срезу. */
export function qualitySnapshots(quality: any): Map<number, QualitySnapshot> {
  const map = new Map<number, QualitySnapshot>();
  for (const request of quality?.requests ?? []) {
    const sliceId = Number(request.slice_id);
    if (!Number.isFinite(sliceId)) continue;
    map.set(sliceId, {
      slice_id: sliceId,
      http_status: request.http_status == null ? null : Number(request.http_status),
      completeness: String(request.completeness ?? "none"),
      row_count: request.row_count == null ? null : Number(request.row_count),
      missing_metrics: Array.isArray(request.missing_metrics) ? request.missing_metrics.map(String) : [],
      missing_dimensions: Array.isArray(request.missing_dimensions) ? request.missing_dimensions.map(String) : [],
      truncated_queries: Array.isArray(request.truncated_queries) ? request.truncated_queries : [],
      duplicate_rows: request.duplicate_rows == null ? null : Number(request.duplicate_rows),
      query_count_mismatch: request.query_count_mismatch === true,
      ratio_weighting: String(request.ratio_weighting ?? ""),
    });
  }
  return map;
}

/** Загружает и нормализует один каталог выгрузки. */
export async function loadRun(dir: string, opts: LoadRunOptions = {}): Promise<NormalizedRun> {
  const root = resolve(dir);
  const mask = opts.maskDimensions ?? true;
  const observationsFile = opts.observationsFile ?? "observations_7745.csv";

  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const quality = JSON.parse(await readFile(join(root, "quality.json"), "utf8"));
  const { header, rows } = parseCsv(await readFile(join(root, observationsFile), "utf8"));
  const records = toObjects(header, rows);

  const shopNo = String(manifest?.shopno ?? "");
  const observations: NormalizedObservation[] = [];
  let totalRows = 0;
  let maskedRows = 0;

  for (const record of records) {
    const metric = record.metric ?? "";
    if (!metric) continue;
    const sliceId = Number(record.slice_id);
    const rawDim1 = record.dimension_1 ?? "";
    const rawDim2 = record.dimension_2 ?? "";
    const dim1 = mask ? redactText(rawDim1).text : rawDim1;
    const dim2 = mask ? redactText(rawDim2).text : rawDim2;
    if (MASK_PLACEHOLDER.test(dim1) || MASK_PLACEHOLDER.test(dim2)) maskedRows++;

    const date = (record.date ?? "").trim();
    const isTotal = date === "" || date === TOTAL_PREFIX;
    const valueRaw = record.value ?? "";
    const parts: NormalizedObservation["parts"] = {
      shop_no: shopNo,
      date,
      slice_id: sliceId,
      dimension_1: dim1,
      dimension_2: dim2,
      metric,
    };
    if (isTotal) totalRows++;
    observations.push({
      key: normalizeKey(parts, isTotal),
      parts,
      isTotal,
      metric_kind: record.metric_kind ?? "",
      value: parseNumber(valueRaw),
      value_raw: valueRaw,
      raw_dimension_1: rawDim1,
      raw_dimension_2: rawDim2,
      dataset_id: record.dataset_id === "" ? null : Number(record.dataset_id),
    });
  }

  const byKey = new Map<string, NormalizedObservation>();
  const duplicateCounts = new Map<string, number>();
  for (const observation of observations) {
    if (byKey.has(observation.key)) {
      duplicateCounts.set(observation.key, (duplicateCounts.get(observation.key) ?? 1) + 1);
    } else {
      byKey.set(observation.key, observation);
    }
  }

  const metricSetBySlice = new Map<number, string[]>();
  const dimensionSetBySlice = new Map<number, string[]>();
  for (const observation of observations) {
    const slice = observation.parts.slice_id;
    const metrics = metricSetBySlice.get(slice) ?? [];
    if (!metrics.includes(observation.parts.metric)) metrics.push(observation.parts.metric);
    metricSetBySlice.set(slice, metrics);

    if (!observation.isTotal) {
      const dimensions = dimensionSetBySlice.get(slice) ?? [];
      for (const dimension of [observation.parts.dimension_1, observation.parts.dimension_2]) {
        if (dimension && !dimensions.includes(dimension)) dimensions.push(dimension);
      }
      dimensionSetBySlice.set(slice, dimensions);
    }
  }

  const qualityBySlice = qualitySnapshots(quality);
  const httpBySlice = new Map<number, number | null>();
  for (const [sliceId, snapshot] of qualityBySlice) httpBySlice.set(sliceId, snapshot.http_status);
  for (const source of manifest?.sources ?? []) {
    const sliceId = Number(source.slice_id);
    if (!httpBySlice.has(sliceId)) httpBySlice.set(sliceId, null);
  }

  return {
    dir: root,
    shop_no: shopNo,
    period: {
      from: String(manifest?.period?.from ?? ""),
      to: String(manifest?.period?.to ?? ""),
      time_range: String(manifest?.period?.time_range ?? ""),
      weeks: manifest?.period?.weeks == null ? null : Number(manifest.period.weeks),
    },
    sources: (manifest?.sources ?? []).map((s: any) => ({
      slice_id: Number(s.slice_id),
      dataset_id: s.datasource_id == null ? null : Number(s.datasource_id),
      request_sha256: String(s.request_sha256 ?? ""),
      file: String(s.file ?? ""),
    })),
    observations,
    by_key: byKey,
    duplicates: [...duplicateCounts.entries()].map(([key, count]) => ({ key, count })),
    metric_set_by_slice: metricSetBySlice,
    dimension_set_by_slice: dimensionSetBySlice,
    quality_by_slice: qualityBySlice,
    http_by_slice: httpBySlice,
    total_rows: totalRows,
    masked_rows: maskedRows,
  };
}
