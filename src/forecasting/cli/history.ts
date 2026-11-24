#!/usr/bin/env bun
/**
 * CLI Stage 3.3.1: сборка расширенной истории и сверка с предыдущей версией canonical dataset.
 *
 *   bun run forecast:history --shop 7745 --slice 20624 \
 *       --intervals q3=dir1,q2=dir2,q1=dir3 --previous <canonical.csv> \
 *       [--out <dir>] [--data-dir <dir>] [--write] [--now <ISO>]
 *
 * Безопасность: новые запросы к Superset НЕ выполняются (читаются готовые артефакты),
 * SQLite не изменяется, canonical CSV перезаписывается только при `--write`
 * и только если сверка не выявила блокирующих расхождений.
 *
 * Коды возврата: 0 — расширение принято, 1 — есть расхождения/ограничения, 2 — BLOCKED, 3 — ошибка аргументов.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildExpandedHistory, profileHistory, readCanonicalCsv } from "../analytics/expansion/history-builder";
import { reconcileHistory } from "../analytics/expansion/history-reconciliation";
import {
  canonicalCsvCompat,
  historyExpansionMarkdown,
  sourceAuditMarkdown,
  writeExpansionArtifacts,
} from "../analytics/expansion/reports";

interface Args {
  shop: string;
  slice: number;
  metric: string;
  intervals: Array<{ label: string; runDir: string }>;
  previous: string;
  out: string;
  dataDir: string;
  write: boolean;
  now: string;
}

const DEFAULT_OUT = "reports/forecasting/stage-3.3";
const DEFAULT_DATA_DIR = "data/processed/forecasting/7745";
const DEFAULT_PREVIOUS = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    shop: "7745",
    slice: 20624,
    metric: "qty_orders_delivered",
    intervals: [],
    previous: DEFAULT_PREVIOUS,
    out: DEFAULT_OUT,
    dataDir: DEFAULT_DATA_DIR,
    write: false,
    now: new Date().toISOString(),
  };
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`не задано значение для ${current}`);
      return value;
    };
    switch (current) {
      case "--shop": args.shop = next(); break;
      case "--slice": args.slice = Number(next()); break;
      case "--metric": args.metric = next(); break;
      case "--previous": args.previous = next(); break;
      case "--out": args.out = next(); break;
      case "--data-dir": args.dataDir = next(); break;
      case "--write": args.write = true; break;
      case "--now": args.now = next(); break;
      case "--intervals": {
        args.intervals = next().split(",").map((entry) => {
          const [label, runDir] = entry.split("=");
          if (!label || !runDir) throw new Error(`интервал должен иметь вид label=dir, получено: ${entry}`);
          return { label, runDir };
        });
        break;
      }
      default: throw new Error(`неизвестный параметр: ${current}`);
    }
  }
  if (!args.intervals.length) throw new Error("укажите --intervals label=dir[,label=dir]");
  return args;
}

/** Параметры источника читаются из фактического request-файла выгрузки (FACT, не догадка). */
async function readRequestFacts(runDir: string): Promise<{
  chartId: number | null;
  datasetId: number | null;
  vizType: string;
  metric: string;
  granularity: string;
  timeGrain: string;
  rowLimit: number | null;
  filters: string[];
  timeField: string;
}> {
  const files = [...new Bun.Glob("*.request.json").scanSync({ cwd: runDir })];
  if (!files.length) throw new Error(`${runDir}: не найден request-файл выгрузки`);
  const body = JSON.parse(await Bun.file(join(runDir, files[0]!)).text());
  const query = body?.queries?.[0] ?? body?.form_data ?? {};
  const filters: string[] = [];
  for (const filter of query.filters ?? []) {
    filters.push(`${filter.col ?? filter.subject} ${filter.op ?? filter.operator} ${JSON.stringify(filter.val ?? filter.comparator)}`);
  }
  return {
    chartId: body?.form_data?.slice_id ?? null,
    datasetId: body?.datasource?.id ?? null,
    vizType: String(body?.form_data?.viz_type ?? ""),
    metric: String((query.metrics ?? [])[0] ?? ""),
    granularity: String(query.granularity ?? ""),
    timeGrain: String(query?.extras?.time_grain_sqla ?? ""),
    rowLimit: query.row_limit == null ? null : Number(query.row_limit),
    filters,
    timeField: String(query.granularity ?? "date_supply"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 3;
  }

  try {
    const history = await buildExpandedHistory({
      shopNo: args.shop,
      metric: args.metric,
      sliceId: args.slice,
      intervals: args.intervals.map((interval) => ({ runDir: resolve(interval.runDir), label: interval.label })),
    });

    const previousRows = (await exists(args.previous)) ? await readCanonicalCsv(args.previous) : [];
    const reconciliation = reconcileHistory(
      previousRows.map((row) => ({ date: row.date, value: row.value })),
      history,
      { previousSourceSliceId: previousRows.length ? args.slice : null },
    );
    const profileNew = profileHistory(history.observations);
    const profileOld = previousRows.length ? profileHistory(previousRows.map((row) => ({ ...row, intervalLabel: "previous", sliceId: args.slice, datasetId: null, manifestSha256: null }))) : null;

    const runIdByDate = new Map<string, string>();
    for (const row of previousRows) runIdByDate.set(row.date, "2");

    const facts = await readRequestFacts(resolve(args.intervals[0]!.runDir));
    const sourceAudit = sourceAuditMarkdown({
      shopNo: args.shop,
      sliceId: args.slice,
      chartId: facts.chartId ?? args.slice,
      datasetId: facts.datasetId ?? 0,
      vizType: facts.vizType,
      metric: args.metric,
      granularity: facts.granularity,
      timeGrain: facts.timeGrain,
      timezone: "Europe/Moscow",
      filters: facts.filters,
      rowLimit: facts.rowLimit,
      timeField: facts.timeField,
      depthDays: history.period.days,
      intervals: history.intervals,
      generatedAt: args.now,
    });

    const expansionMarkdown = historyExpansionMarkdown({ history, reconciliation, profileNew, profileOld, generatedAt: args.now });

    // Архив предыдущей версии canonical CSV (перед возможной перезаписью)
    const canonicalPath = join(resolve(args.dataDir), "canonical_daily_delivered_orders.csv");
    const archivePath = join(resolve(args.dataDir), "archive", "canonical_daily_delivered_orders.stage-3.2.csv");
    if (args.write && (await exists(canonicalPath)) && !(await exists(archivePath))) {
      await mkdir(join(resolve(args.dataDir), "archive"), { recursive: true });
      await copyFile(canonicalPath, archivePath);
    }

    const ledger = new Bun.CryptoHasher("sha256")
      .update(history.observations.map((observation) => `${observation.date}:${observation.value}`).join("|"))
      .digest("hex");
    const blocked = reconciliation.status === "BLOCKED" || history.duplicates.length > 0;
    // canonical перезаписывается ТОЛЬКО когда прежние значения воспроизведены без изменений:
    // расхождение (VALUE_CHANGED/MISSING) требует решения человека, а не молчаливой перезаписи
    const writeAllowed = reconciliation.status === "IDENTICAL" || reconciliation.status === "MATCH_WITH_EXTENSIONS";
    const writeCanonical = args.write && !blocked && writeAllowed && history.missingDates.length === 0;
    const writeRefusal = args.write && !writeCanonical
      ? blocked
        ? `запись запрещена: статус сверки ${reconciliation.status}, дубликатов ${history.duplicates.length}`
        : !writeAllowed
          ? `запись запрещена: статус сверки ${reconciliation.status} (расхождения прежних значений требуют решения)`
          : `запись запрещена: пропущено ${history.missingDates.length} календарных дат`
      : null;

    const artifacts = await writeExpansionArtifacts({
      outDir: resolve(args.out),
      dataOutDir: resolve(args.dataDir),
      sourceAudit,
      expansionMarkdown,
      history,
      reconciliation,
      profileNew,
      profileOld,
      canonicalCsv: canonicalCsvCompat(history, runIdByDate),
      writeCanonical,
    });

    console.log(JSON.stringify({
      shop: args.shop,
      slice_id: args.slice,
      metric: args.metric,
      intervals: history.intervals.map((interval) => ({ label: interval.label, rows: interval.rows, http: interval.httpStatus, completeness: interval.completeness })),
      available_depth_days: history.period.days,
      period: history.period,
      observations: history.observations.length,
      missing_dates: history.missingDates.length,
      duplicates: history.duplicates.length,
      rejected_rows: history.rejectedRows.length,
      history_checksum: history.checksum,
      ledger_checksum: ledger,
      previous_version: { dates: previousRows.length, status: reconciliation.status, counts: reconciliation.counts },
      profile_new: { mean: profileNew.mean, median: profileNew.median, stdev: profileNew.stdev, outliers_iqr: profileNew.outlierCountIqr, outliers_mad: profileNew.outlierCountMad },
      canonical_written: writeCanonical,
      write_refusal: writeRefusal,
      archived_previous: (await exists(archivePath)) ? archivePath : null,
      artifacts: artifacts.written,
    }, null, 2));

    if (blocked) return 2;
    return reconciliation.status === "IDENTICAL" || reconciliation.status === "MATCH_WITH_EXTENSIONS" ? 0 : 1;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
