#!/usr/bin/env bun
/**
 * CLI Stage 3.2: бизнес-семантика → канонический источник → дневной набор → сверка.
 *
 *   bun run forecast:canonical --shop 7745 [--db <path>] [--out <dir>] [--data-out <csv>]
 *                               [--from <date>] [--to <date>] [--expect-total <n>] [--expect-days <n>] [--now <ISO>]
 *
 * Безопасность: SQLite открывается ТОЛЬКО для чтения (readonly + PRAGMA query_only = 1),
 * миграции не применяются, канонический CSV не создаётся при статусе BLOCKED.
 *
 * Коды возврата: 0 — PASS, 1 — CONDITIONAL, 2 — BLOCKED, 3 — ошибка аргументов.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { buildCanonicalDailyDataset } from "../analytics/canonical-dataset/builder";
import { CANONICAL_DECISION, verifyDecision } from "../analytics/canonical-dataset/decision";
import { reconcileDataset } from "../analytics/canonical-dataset/reconciliation";
import { writeStage32Artifacts, type IntegritySnapshot } from "../analytics/canonical-dataset/reports";
import { selectCanonicalSource } from "../analytics/canonical-dataset/selection";
import {
  crossSliceDailyTotals,
  loadMetricRows,
  metricPeriod,
  sliceCandidateStats,
  slicesForMetric,
} from "../analytics/canonical-dataset/source-loader";
import { validateCanonicalDataset } from "../analytics/canonical-dataset/validation";
import { openReadOnlyDatabase, readIntegrity, readTableCounts } from "../analytics/profiling/read-only";
import { TARGET_METRIC_BUSINESS_NAME, TARGET_METRIC_KEY, assertMetricUsable, validateRegistry } from "../analytics/semantics/metric-registry";
import type { Database } from "bun:sqlite";

interface Args {
  shop: string;
  db: string;
  out: string;
  dataOut: string;
  from: string | null;
  to: string | null;
  expectTotal: number | null;
  expectDays: number | null;
  now: string;
}

const DEFAULT_DB = "data/forecast/forecasting.sqlite";
const DEFAULT_OUT = "reports/forecasting/stage-3.2";
const DEFAULT_DATA_OUT = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    shop: "7745",
    db: DEFAULT_DB,
    out: DEFAULT_OUT,
    dataOut: DEFAULT_DATA_OUT,
    from: null,
    to: null,
    expectTotal: null,
    expectDays: null,
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
      case "--db": args.db = next(); break;
      case "--out": args.out = next(); break;
      case "--data-out": args.dataOut = next(); break;
      case "--from": args.from = next(); break;
      case "--to": args.to = next(); break;
      case "--expect-total": args.expectTotal = Number(next()); break;
      case "--expect-days": args.expectDays = Number(next()); break;
      case "--now": args.now = next(); break;
      default: throw new Error(`неизвестный параметр: ${current}`);
    }
  }
  return args;
}

async function snapshot(dbPath: string, db: Database, writeBlocked: boolean): Promise<IntegritySnapshot> {
  const info = await stat(dbPath);
  const bytes = new Uint8Array(await Bun.file(dbPath).arrayBuffer());
  const integrity = readIntegrity(db);
  return {
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    size: info.size,
    lastWriteTime: info.mtime.toISOString(),
    counts: readTableCounts(db),
    integrity: integrity.integrity,
    foreignKeyViolations: integrity.foreign_key_violations,
    queryOnly: integrity.query_only,
    writeBlocked,
  };
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 3;
  }

  const dbPath = resolve(args.db);
  const connection = openReadOnlyDatabase(dbPath);
  try {
    const registryCheck = validateRegistry();
    const targetMetric = assertMetricUsable(TARGET_METRIC_KEY);
    if (!registryCheck.ok) {
      console.error(`[ОШИБКА] реестр семантики не прошёл проверку: ${registryCheck.errors.join("; ")}`);
      return 2;
    }

    const before = await snapshot(dbPath, connection.db, connection.writeBlocked);

    // Stage 3.2.2 — анализ кандидатов и выбор источника
    const rows = loadMetricRows(connection.db, args.shop, TARGET_METRIC_KEY);
    const period = metricPeriod(rows);
    const from = args.from ?? period.from;
    const toInclusive = args.to ?? period.to;
    const to = addOneDay(toInclusive);
    const expectedDays = args.expectDays ?? period.days;
    const slices = slicesForMetric(rows);
    const candidates = slices.map((slice) => sliceCandidateStats(rows, slice, period.days));
    const crossSlice = crossSliceDailyTotals(rows, slices);
    const selection = selectCanonicalSource(candidates, crossSlice, period.days);
    const verification = verifyDecision(CANONICAL_DECISION, selection);

    const blocked = !verification.ok || CANONICAL_DECISION.status === "BLOCKED" || selection.status === "BLOCKED";

    // Stage 3.2.3 — построение набора (два независимых построения для проверки детерминированности)
    const first = buildCanonicalDailyDataset(rows, {
      shopNo: args.shop,
      metric: TARGET_METRIC_KEY,
      businessName: TARGET_METRIC_BUSINESS_NAME,
      sourceSliceId: CANONICAL_DECISION.sliceId ?? -1,
      from,
      to,
      generatedAt: args.now,
    });
    const secondRows = loadMetricRows(connection.db, args.shop, TARGET_METRIC_KEY);
    const second = buildCanonicalDailyDataset(secondRows, {
      shopNo: args.shop,
      metric: TARGET_METRIC_KEY,
      businessName: TARGET_METRIC_BUSINESS_NAME,
      sourceSliceId: CANONICAL_DECISION.sliceId ?? -1,
      from,
      to,
      generatedAt: args.now,
    });
    const identical = first.dataset.provenance.checksum === second.dataset.provenance.checksum;

    const validation = validateCanonicalDataset(first.dataset, { expectedFrom: period.from, expectedToInclusive: period.to });
    const reconciliation = reconcileDataset({
      dataset: first.dataset,
      rows,
      candidates,
      crossSlice,
      expected: {
        from: period.from,
        toInclusive: period.to,
        days: expectedDays,
        total: args.expectTotal ?? undefined,
      },
      determinism: { runs: 2, identical },
    });

    const after = await snapshot(dbPath, connection.db, connection.writeBlocked);

    const artifacts = await writeStage32Artifacts({
      outDir: resolve(args.out),
      canonicalCsvPath: resolve(args.dataOut),
      status: blocked ? "BLOCKED" : reconciliation.status,
      dataset: blocked ? null : first.dataset,
      decision: CANONICAL_DECISION,
      selection,
      validation,
      reconciliation,
      candidates,
      crossSlice,
      slices,
      expectedPeriod: { from: period.from, toInclusive: period.to, days: expectedDays },
      integrityBefore: before,
      integrityAfter: after,
      testsSummary: "см. отчёт о тестах этапа (bun test tests/forecasting)",
      generatedAt: args.now,
    });

    console.log(JSON.stringify({
      shop: args.shop,
      metric: targetMetric.metric_key,
      business_name: TARGET_METRIC_BUSINESS_NAME,
      decision: { slice_id: CANONICAL_DECISION.sliceId, status: CANONICAL_DECISION.status, verified: verification.ok },
      selection: { status: selection.status, slice_id: selection.sliceId, evidence: selection.evidence, reasons: selection.reasons },
      slices,
      period: { from: period.from, to: period.to, days: period.days, expected_from: from, expected_to_exclusive: to },
      dataset: blocked ? null : {
        rows: first.dataset.observations.length,
        total_delivered: first.dataset.totalDelivered,
        excluded_totals: first.dataset.excludedTotalsRows,
        quality_status: first.dataset.observations[0]?.qualityStatus ?? "blocked",
        checksum: first.dataset.provenance.checksum,
      },
      validation: { ok: validation.ok, issues: validation.issues.length },
      reconciliation: { status: reconciliation.status, counts: reconciliation.counts, totals: reconciliation.totals, cross_slice_mismatches: reconciliation.crossSliceMismatches, deterministic: identical },
      read_only: { query_only: after.queryOnly, write_blocked: after.writeBlocked, db_sha256_before: before.sha256, db_sha256_after: after.sha256, db_unchanged: before.sha256 === after.sha256 },
      artifacts: artifacts.written,
    }, null, 2));

    if (blocked) return 2;
    return reconciliation.status === "PASS" ? 0 : 1;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  } finally {
    connection.db.close(false);
  }
}

function addOneDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
