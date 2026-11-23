#!/usr/bin/env bun
/**
 * Сборка канонического каталога выгрузки из поштучных прогонов сборщика.
 *
 * Зачем: при залпе из нескольких тяжёлых запросов ClickHouse через Superset отвечает 429/500,
 * поэтому срезы собираются по одному (`--files N` в отдельный каталог). Этот инструмент
 * объединяет такие прогоны в один набор артефактов, СОХРАНЯЯ провенанс каждого среза:
 * какой запуск, когда, с каким request_sha256 его получил.
 *
 *   bun src/forecasting/cli/assemble-refresh.ts --staging <dir> --out <dir> [--force]
 *
 * Требования к входам: каждый каталог staging содержит ровно один источник в manifest.json,
 * HTTP 200 и completeness=full. Иначе сборка не выполняется (неполный набор не собираем).
 * Исходные каталоги staging не изменяются и не удаляются.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface Args {
  staging: string;
  out: string;
  force: boolean;
}

interface SliceRun {
  dir: string;
  file: string;
  sliceId: number;
  requestSha: string;
  generatedAt: string;
  runStartedAt: string;
  manifest: Record<string, any>;
  quality: Record<string, any>;
  validation: Record<string, any>;
  observationsCsv: string;
  aggregateCsv: string;
  requestJson: string;
  responseJson: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { staging: "", out: "", force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`не задано значение для ${a}`);
      return v;
    };
    switch (a) {
      case "--staging": args.staging = next(); break;
      case "--out": args.out = next(); break;
      case "--force": args.force = true; break;
      default: throw new Error(`неизвестный параметр: ${a}`);
    }
  }
  if (!args.staging || !args.out) {
    throw new Error("использование: --staging <dir> --out <dir> [--force]");
  }
  return args;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0));

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 2;
  }

  const staging = resolve(args.staging);
  const out = resolve(args.out);

  const entries = (await readdir(staging, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (!entries.length) {
    console.error(`[ОШИБКА] в ${staging} нет каталогов прогонов`);
    return 1;
  }

  const runs: SliceRun[] = [];
  for (const name of entries) {
    const dir = join(staging, name);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    const quality = JSON.parse(await readFile(join(dir, "quality.json"), "utf8"));
    const validation = JSON.parse(await readFile(join(dir, "validation.json"), "utf8"));

    if (manifest.sources.length !== 1) {
      console.error(`[ОШИБКА] ${name}: ожидался ровно один источник, найдено ${manifest.sources.length}`);
      return 1;
    }
    const request = quality.requests[0];
    if (request.http_status !== 200 || request.completeness !== "full") {
      console.error(`[ОШИБКА] ${name}: http=${request.http_status} completeness=${request.completeness} — неполный срез не собираем`);
      return 1;
    }

    const files = await readdir(dir);
    const requestFile = files.find((f) => f.endsWith(".request.json") && f.includes("slice_"))!;
    const responseFile = files.find((f) => f.endsWith(".response.json") && f.includes("slice_"))!;
    runs.push({
      dir: name,
      file: name,
      sliceId: num(manifest.sources[0].slice_id),
      requestSha: String(manifest.sources[0].request_sha256 ?? ""),
      generatedAt: String(manifest.generated_at ?? ""),
      runStartedAt: String(manifest.period?.from ?? ""),
      manifest,
      quality,
      validation,
      observationsCsv: await readFile(join(dir, "observations_7745.csv"), "utf8"),
      aggregateCsv: await readFile(join(dir, "aggregate_7745.csv"), "utf8"),
      requestJson: await readFile(join(dir, requestFile), "utf8"),
      responseJson: await readFile(join(dir, responseFile), "utf8"),
    });
  }

  runs.sort((a, b) => a.sliceId - b.sliceId);
  const assembledAt = new Date().toISOString();

  try {
    await readdir(out);
    if (!args.force) {
      console.error(`[ОШИБКА] каталог ${out} уже существует; для перезаписи нужен --force`);
      return 1;
    }
    await rm(out, { recursive: true, force: true });
  } catch {
    // каталога нет — это нормальный случай
  }
  await mkdir(out, { recursive: true });

  // --- CSV: общий заголовок + строки всех срезов ---------------------------------
  const mergeCsv = (chunks: string[]): string => {
    const header = chunks[0]!.split("\n")[0]!;
    const rows = chunks.flatMap((c) => c.split(/\r?\n/).slice(1).filter((r) => r.trim() !== ""));
    return `${[header, ...rows].join("\n")}\n`;
  };
  await writeFile(join(out, "observations_7745.csv"), mergeCsv(runs.map((r) => r.observationsCsv)), "utf8");
  await writeFile(join(out, "aggregate_7745.csv"), mergeCsv(runs.map((r) => r.aggregateCsv)), "utf8");

  // --- поштучные файлы запросов/ответов (нумерация по возрастанию slice_id) ------
  for (const [index, run] of runs.entries()) {
    const prefix = String(index + 1).padStart(3, "0");
    await writeFile(join(out, `${prefix}_slice_${run.sliceId}.request.json`), run.requestJson, "utf8");
    await writeFile(join(out, `${prefix}_slice_${run.sliceId}.response.json`), run.responseJson, "utf8");
  }

  // --- составной manifest с провенансом по каждому срезу ------------------------
  const template = runs[0]!.manifest;
  const sources = runs.map((r) => r.manifest.sources[0]);
  const requests = runs.map((r) => r.quality.requests[0]);
  const observationsHeader = runs[0]!.observationsCsv.split("\n")[0]!;
  const aggregateHeader = runs[0]!.aggregateCsv.split("\n")[0]!;
  const countRows = (csv: string) => csv.split(/\r?\n/).slice(1).filter((r) => r.trim() !== "").length;

  const manifest = {
    ...template,
    generated_at: assembledAt,
    notes: [
      ...(template.notes ?? []),
      "Набор собран из поштучных прогонов (стратегия per-slice): залп из пяти тяжёлых запросов отклонялся движком ClickHouse (429 → HTTP 500 на стороне Superset).",
      `Провенанс: поле collection.runs содержит для каждого среза время его прогона, request_sha256 и имя staging-каталога. Сборка выполнена ${assembledAt}.`,
    ],
    collection: {
      strategy: "per-slice",
      assembled_at: assembledAt,
      runs: runs.map((r) => ({
        slice_id: r.sliceId,
        staging_dir: r.file,
        generated_at: r.generatedAt,
        request_sha256: r.requestSha,
      })),
    },
    sources,
    observations: countRows(mergeCsv(runs.map((r) => r.observationsCsv))),
    aggregate_rows: countRows(mergeCsv(runs.map((r) => r.aggregateCsv))),
    requests: runs.length,
    outputs: { observations_csv_header: observationsHeader, aggregate_csv_header: aggregateHeader },
    quality_per_request: requests.map((r) => ({ slice_id: r.slice_id, http_status: r.http_status, completeness: r.completeness, row_count: r.row_count })),
    completeness: {
      counts: {
        full: requests.filter((r) => r.completeness === "full").length,
        partial: requests.filter((r) => r.completeness === "partial").length,
        truncated: requests.filter((r) => r.completeness === "truncated").length,
        none: requests.filter((r) => r.completeness === "none").length,
      },
    },
  };
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // --- составной quality --------------------------------------------------------
  const quality = {
    ...template,
    generated_at: assembledAt,
    mode: "live-assembled",
    run: {
      requests: runs.length,
      completeness: manifest.completeness.counts,
      full: requests.filter((r) => r.completeness === "full").map((r) => r.slice_id),
      partial: requests.filter((r) => r.completeness === "partial").map((r) => r.slice_id),
      truncated: requests.filter((r) => r.completeness === "truncated").map((r) => r.slice_id),
      none: requests.filter((r) => r.completeness === "none").map((r) => r.slice_id),
      duplicate_rows_total: requests.reduce((a, r) => a + num(r.duplicate_rows), 0),
      missing_metrics_total: requests.reduce((a, r) => a + (r.missing_metrics?.length ?? 0), 0),
      ratio_weighting: {
        weighted: requests.filter((r) => String(r.ratio_weighting).startsWith("weighted")).map((r) => r.slice_id),
        unweighted: requests.filter((r) => r.ratio_weighting === "none").map((r) => r.slice_id),
        mixed: [],
      },
    },
    requests,
  };
  await writeFile(join(out, "quality.json"), `${JSON.stringify(quality, null, 2)}\n`, "utf8");

  // --- составной validation -----------------------------------------------------
  const validationTemplate = runs[0]!.validation;
  const validation = {
    ...validationTemplate,
    generated_at: assembledAt,
    summary: {
      ...(validationTemplate.summary ?? {}),
      requests: runs.length,
      ok: requests.filter((r) => r.http_status === 200).length,
      failed: requests.filter((r) => r.http_status !== 200).length,
    },
    expected_colnames_by_slice: Object.assign(
      {},
      ...runs.map((r) => r.validation.expected_colnames_by_slice ?? {}),
    ),
    requests: runs.flatMap((r) => r.validation.requests ?? []),
  };
  await writeFile(join(out, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    out,
    slices: runs.map((r) => r.sliceId),
    observations: manifest.observations,
    aggregate_rows: manifest.aggregate_rows,
    requests: requests.map((r) => `${r.slice_id}:${r.http_status}/${r.completeness}`),
    completeness: manifest.completeness.counts,
  }, null, 2));
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    process.exitCode = 1;
  }
}
