/** UI-4.2.3: секция «Прогнозы и качество» — отображение read-model прогнозной аналитики. */
import { card, dataTable, formatDate, formatNumber, kpiGrid, pageHeader, provenanceDrawer, statusBadge, trusted, type TrustedHtml } from "../components";

export interface MetricsDto {
  mode: string; horizon: number; modelId: string; modelVersion: string; n: number;
  mae: number | null; wape: number | null; bias: number | null;
  maeStatus: string; wapeStatus: string; biasStatus: string;
  underN: number; overN: number; exactN: number; excludedN: number; overflowAffectedN: number;
  /** Техническая полнота выборки метрики; NOT_AVAILABLE — безопасное состояние при отсутствии данных. */
  sampleStatus: "COMPLETE" | "PARTIAL" | "NOT_AVAILABLE"; semantics: string;
}
export interface QualityDto {
  mode: "replay" | "shadow"; horizon: number; semantics: string; technicalFactCutoff: string | null;
  independentMetrics: MetricsDto[];
  pairedComparison: { available: boolean; pairedN: number; maeBaseline: number | null; maeCandidate: number | null; deltaMae: number | null; status: string };
  pairCounters: { baselineIndependentN: number; candidateIndependentN: number; pairedN: number; excludedBaselineN: number; excludedCandidateN: number; unmatchedN: number; conflictN: number; pendingN: number; missingActualN: number; duplicateN: number; unknownN: number };
  metricDiagnostics: Array<{ modelId: string; excludedN: number; overflowAffectedN: number; sampleStatus: string }>;
  sampleStatus: string;
  interpretabilityStatus: "NOT_AVAILABLE" | "INSUFFICIENT" | "LIMITED" | "NOT_ASSESSED";
  warnings: string[];
  provenance: { datasetChecksums: string[]; datasetVersionWarning: boolean; manifestStatus: string; freshness: string; shadowFileChecksums: Record<string, string> };
  availability: { available: boolean; reason: string | null };
}

const MODE_LABEL: Record<string, string> = { replay: "Историческая диагностика (Replay)", shadow: "Текущий Shadow Mode" };
const INTERPRETABILITY_LABEL: Record<string, string> = {
  NOT_AVAILABLE: "сравнение недоступно",
  INSUFFICIENT: "недостаточно наблюдений",
  LIMITED: "ограниченная интерпретация",
  NOT_ASSESSED: "не оценивалось",
};

/** Обязательные предупреждения: победитель не объявляется, малая выборка не выдаётся за результат. */
export function qualityWarnings(data: QualityDto): string[] {
  const warnings: string[] = [];
  if (data.mode === "replay") warnings.push("Историческая диагностика. Не является текущим Shadow Mode.");
  if (data.mode === "shadow") {
    const maxN = Math.max(0, ...data.independentMetrics.map((metric) => metric.n));
    if (maxN === 1) warnings.push("Недостаточно наблюдений для оценки качества модели. Показанные значения носят описательный характер.");
    if (data.pairedComparison.pairedN === 0) warnings.push("Недостаточно созревших пар для сравнения моделей.");
  }
  if (data.semantics === "PROVISIONAL") warnings.push("Бизнес-семантика фактических данных не подтверждена.");
  if (data.provenance.datasetVersionWarning) warnings.push("Выборка содержит несколько версий dataset_checksum — сравнение ограничено.");
  if (data.pairCounters.pendingN > 0) warnings.push(`Ожидают факта: ${data.pairCounters.pendingN}. Это не ошибка.`);
  return warnings;
}

function metricValue(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "[Н/Д]" : formatNumber(value, digits);
}

/**
 * UI-4.2.5: статус метрики разделяет техническую доступность значения, полноту наблюдений
 * и возможность интерпретации. Зелёный OK не используется как оценка качества модели.
 */
const VALID_SAMPLE_STATUS = new Set(["COMPLETE", "PARTIAL"]);
const VALID_INTERPRETABILITY = new Set(["NOT_AVAILABLE", "INSUFFICIENT", "LIMITED", "NOT_ASSESSED"]);

export function metricPresentation(input: {
  value: number | null;
  digits?: number;
  n: number;
  sampleStatus: string;
  interpretabilityStatus: string;
}): { value: string; status: "OK" | "PENDING" | "NOT_AVAILABLE" | "PROVISIONAL"; note: string; interpretable: boolean } {
  const { value, n, sampleStatus, interpretabilityStatus } = input;
  const digits = input.digits ?? 2;
  // fail-closed: значение показывается только при конечном числе, корректном n и известной полноте выборки
  const valueAvailable = typeof value === "number" && Number.isFinite(value);
  const sampleValid = Number.isSafeInteger(n) && n > 0 && VALID_SAMPLE_STATUS.has(sampleStatus);
  const interpretability = VALID_INTERPRETABILITY.has(interpretabilityStatus) ? interpretabilityStatus : "NOT_ASSESSED";

  if (!valueAvailable) {
    return { value: "[Н/Д]", status: "NOT_AVAILABLE", note: `n = ${n} · значение недоступно`, interpretable: false };
  }
  if (!sampleValid) {
    return { value: "[Н/Д]", status: "NOT_AVAILABLE", note: `n = ${n} · выборка недоступна (${sampleStatus})`, interpretable: false };
  }
  if (interpretability === "NOT_AVAILABLE" || interpretability === "NOT_ASSESSED") {
    return { value: "[Н/Д]", status: "NOT_AVAILABLE", note: `n = ${n} · интерпретация недоступна`, interpretable: false };
  }
  if (interpretability === "INSUFFICIENT") {
    return { value: metricValue(value, digits), status: "PENDING", note: `n = ${n} · описательное значение, недостаточно наблюдений`, interpretable: false };
  }
  return { value: metricValue(value, digits), status: "PENDING", note: `n = ${n} · ${sampleStatus} · ограниченная интерпретация`, interpretable: true };
}
export function forecastQualityPage(input: { data: QualityDto; mode: "replay" | "shadow"; horizon: number }): TrustedHtml {
  const data = input.data;
  const warnings = qualityWarnings(data);
  const baseline = data.independentMetrics.find((metric) => metric.modelId === "rolling_7_day_mean");
  const candidate = data.independentMetrics.find((metric) => metric.modelId === "adaptive_baseline");
  const paired = data.pairedComparison;
  const interpretabilityStatus = data.interpretabilityStatus === "LIMITED" ? "PENDING" : data.interpretabilityStatus === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : "PENDING";
  const modeSwitcher = (["replay", "shadow"] as const)
    .map((mode) => `<a class="ds-badge ${mode === input.mode ? "ds-badge--ok" : "ds-badge--na"}" href="#forecast-quality/${mode}/${input.horizon}">${MODE_LABEL[mode]}</a>`)
    .join(" ");
  const horizonSwitcher = ([1, 3] as const)
    .map((horizon) => `<a class="ds-badge ${horizon === input.horizon ? "ds-badge--provisional" : "ds-badge--na"}" href="#forecast-quality/${input.mode}/${horizon}">h${horizon}</a>`)
    .join(" ");

  const diagnosticsTable = data.metricDiagnostics.length
    ? dataTable({
        columns: [{ key: "model", label: "Модель" }, { key: "excluded", label: "Исключено", numeric: true }, { key: "overflow", label: "Переполнение", numeric: true }, { key: "sample", label: "Полнота" }],
        rows: data.metricDiagnostics.map((entry) => ({ model: entry.modelId, excluded: entry.excludedN, overflow: entry.overflowAffectedN, sample: entry.sampleStatus })),
      })
    : trusted("");
  return trusted(`
${pageHeader({
    title: "Прогнозы и качество моделей",
    subtitle: `baseline rolling_7_day_mean · candidate adaptive_baseline (Variant B) · горизонт h${data.horizon}`,
    right: trusted(`${statusBadge({ status: "PROVISIONAL" })} ${statusBadge({ status: interpretabilityStatus as never, text: INTERPRETABILITY_LABEL[data.interpretabilityStatus] ?? data.interpretabilityStatus })}`),
  })}
${card({ title: "Режим и горизонт", subtitle: "Replay и Shadow не смешиваются", body: trusted(`<div class="ds-row">${modeSwitcher}<span class="ds-sub">|</span>${horizonSwitcher}</div>`) })}
${card({
    title: "Независимые метрики",
    subtitle: "по всем пригодным наблюдениям модели, не по парной выборке",
    body: (() => {
      const presentation = (metric: MetricsDto | undefined, field: "mae" | "wape" | "bias", label: string, digits = 2) => {
        const result = metricPresentation({ value: metric ? metric[field] : null, digits, n: metric?.n ?? 0, sampleStatus: metric?.sampleStatus ?? "NOT_AVAILABLE", interpretabilityStatus: data.interpretabilityStatus });
        return { label, value: field === "wape" && result.value !== "[Н/Д]" ? `${result.value} %` : result.value, note: result.note, status: result.status };
      };
      return kpiGrid([
        presentation(baseline, "mae", "MAE baseline"),
        presentation(candidate, "mae", "MAE candidate"),
        presentation(baseline, "wape", "WAPE baseline", 3),
        presentation(candidate, "wape", "WAPE candidate", 3),
        presentation(baseline, "bias", "Bias baseline"),
        presentation(candidate, "bias", "Bias candidate"),
      ]);
    })(),
  })}
${card({
    title: "Парное сравнение",
    subtitle: `общая выборка: pairedN = ${paired.pairedN}; победитель не объявляется`,
    right: statusBadge({ status: paired.available ? "PENDING" : "NOT_AVAILABLE", text: INTERPRETABILITY_LABEL[data.interpretabilityStatus] ?? data.interpretabilityStatus }),
    body: (() => {
      const pairedPresentation = (value: number | null, label: string) => {
        const result = metricPresentation({ value, n: paired.pairedN, sampleStatus: data.sampleStatus, interpretabilityStatus: data.interpretabilityStatus });
        return { label, value: result.value, note: `pairedN = ${paired.pairedN} · ${result.interpretable ? "ограниченная интерпретация" : "не для выводов"}`, status: result.status };
      };
      return kpiGrid([
        pairedPresentation(paired.maeBaseline, "MAE baseline (пара)"),
        pairedPresentation(paired.maeCandidate, "MAE candidate (пара)"),
        { ...pairedPresentation(paired.deltaMae, "Δ MAE (описательно)"), note: paired.available ? "не доказательство превосходства" : "сравнение недоступно" },
        { label: "Статус сравнения", value: paired.status, note: `${data.interpretabilityStatus} · победитель не объявляется`, status: data.interpretabilityStatus === "LIMITED" ? "PENDING" : "NOT_AVAILABLE" },
      ]);
    })(),
  })}
${card({
    title: "Полнота и диагностика",
    body: kpiGrid([
      { label: "Полнота выборки", value: data.sampleStatus, note: "техническая полнота, не статистическая достаточность", status: data.sampleStatus === "COMPLETE" ? "OK" : "PENDING" },
      { label: "Интерпретируемость", value: data.interpretabilityStatus, status: interpretabilityStatus as never },
      { label: "Ожидают факта", value: formatNumber(data.pairCounters.pendingN), note: "pending не является ошибкой", status: "PENDING" },
      { label: "Исключено", value: `${data.pairCounters.excludedBaselineN} / ${data.pairCounters.excludedCandidateN}`, note: "baseline / candidate", status: "PENDING" },
      { label: "Конфликты", value: formatNumber(data.pairCounters.conflictN), status: data.pairCounters.conflictN ? "CONFLICT" : "OK" },
      { label: "Неизвестные записи", value: formatNumber(data.pairCounters.unknownN), status: data.pairCounters.unknownN ? "PENDING" : "OK" },
    ]),
  })}
${card({ title: "Предупреждения", body: trusted(`<ul class="ds-sub">${warnings.map((warning) => `<li>${warning}</li>`).join("")}</ul>`) })}
${card({
    title: "Происхождение данных",
    body: trusted(`${provenanceDrawer({
      source: `shadow JSONL (${data.mode}) · technicalFactCutoff ${formatDate(data.technicalFactCutoff)}`,
      checksum: data.provenance.datasetChecksums.join(", ") || "[Н/Д]",
      version: `manifest: ${data.provenance.manifestStatus} · freshness: ${data.provenance.freshness}`,
      note: data.provenance.datasetVersionWarning ? "несколько версий dataset_checksum" : "единая версия выборки",
    })}
  ${diagnosticsTable}`),
  })}
`);
}
