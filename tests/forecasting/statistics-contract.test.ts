// Stage 3.4.5: числовые тесты статистических правил протокола.
//
// Модуль `src/forecasting/analytics/diagnostics/statistics.ts` удалён как вышедший
// за согласованный scope. Эталонные реализации формул из протокола объявлены локально
// внутри теста: это контрактные проверки документа, а не production-код.
import { describe, expect, test } from "bun:test";

const PROTOCOL = "docs/forecasting/contracts/adaptive-baseline-protocol.md";
const SPEC = "docs/forecasting/contracts/adaptive-baseline-spec.md";

/** Holm-adjusted p-values: p_adj_(j) = max_{k ≤ j} min(1, (m − k + 1) × p_(k)). */
function holmAdjusted(pValues: readonly number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  for (const value of pValues) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`p-value вне [0, 1]: ${String(value)}`);
  }
  const order = pValues.map((pValue, index) => ({ pValue, index })).sort((a, b) => a.pValue - b.pValue);
  const adjusted = new Array<number>(m).fill(0);
  let running = 0;
  order.forEach((entry, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * entry.pValue));
    adjusted[entry.index] = running;
  });
  return adjusted;
}

/** Линейный перцентиль (индексация с нуля): sorted[lower] + w × (sorted[upper] − sorted[lower]). */
function percentileLinear(values: readonly number[], q: number): number {
  if (!values.length) throw new Error("пустой массив");
  if (!(q >= 0 && q <= 1)) throw new Error(`q вне [0, 1]: ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! + weight * (sorted[upper]! - sorted[lower]!);
}

function rejectByHolm(adjustedP: readonly number[], alpha = 0.05): boolean[] {
  return adjustedP.map((pValue) => pValue < alpha);
}

function holmThresholds(m: number, alpha = 0.05): number[] {
  if (!Number.isInteger(m) || m <= 0) throw new Error(`некорректное m: ${m}`);
  return Array.from({ length: m }, (_, rank) => alpha / (m - rank));
}

describe("Holm-adjusted p-values", () => {
  test("для двух сравнений: p_adj_(1) = min(1, 2p_(1)), p_adj_(2) = max(p_adj_(1), min(1, p_(2)))", () => {
    expect(holmAdjusted([0.01, 0.03])).toEqual([0.02, 0.03]);
    expect(holmAdjusted([0.03, 0.04])).toEqual([0.06, 0.06]);
    expect(holmAdjusted([0.5, 0.6])).toEqual([1, 1]);
  });

  test("p_adj_(2) не меньше p_adj_(1) после сортировки", () => {
    for (const [a, b] of [[0.001, 0.049], [0.04, 0.041], [0.2, 0.9], [0.0001, 0.9]] as const) {
      const adjusted = holmAdjusted([a, b]);
      expect(adjusted[1]!).toBeGreaterThanOrEqual(adjusted[0]!);
    }
  });

  test("порядок исходных значений не влияет на корректность", () => {
    expect(holmAdjusted([0.04, 0.01])).toEqual([0.04, 0.02]);
  });

  test("граничные случаи: нули, единицы, больше двух сравнений", () => {
    expect(holmAdjusted([0, 0])).toEqual([0, 0]);
    expect(holmAdjusted([1, 1])).toEqual([1, 1]);
    expect(holmAdjusted([0.001, 0.004, 0.04, 0.049])).toEqual([0.004, 0.012, 0.08, 0.08]);
    expect(holmAdjusted([])).toEqual([]);
  });

  test("некорректные p-value и нечисловые значения отклоняются", () => {
    expect(() => holmAdjusted([-0.1, 0.2])).toThrow(/вне \[0, 1\]/);
    expect(() => holmAdjusted([0.1, 1.2])).toThrow(/вне \[0, 1\]/);
    expect(() => holmAdjusted([Number.NaN])).toThrow(/вне \[0, 1\]/);
    expect(() => holmAdjusted([Number.POSITIVE_INFINITY])).toThrow(/вне \[0, 1\]/);
    expect(() => holmAdjusted([Number.NEGATIVE_INFINITY])).toThrow(/вне \[0, 1\]/);
  });

  test("решение принимается строго по p_adj < 0.05", () => {
    expect(rejectByHolm([0.04, 0.06])).toEqual([true, false]);
    expect(rejectByHolm([0.05, 0.05])).toEqual([false, false]);
    expect(rejectByHolm([0.001, 0.049])).toEqual([true, true]);
  });

  test("последовательные пороги Holm отличаются от adjusted p-values", () => {
    expect(holmThresholds(2)).toEqual([0.025, 0.05]);
    expect(holmAdjusted([0.02, 0.02])).toEqual([0.04, 0.04]);
  });
});

describe("перцентиль с нулевой индексацией", () => {
  test("известный массив: q95 для [1..5] = 4,8", () => {
    expect(percentileLinear([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 10);
  });

  test("для 100 значений q95 = sorted[94] + 0,05 × (sorted[95] − sorted[94])", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const sorted = [...values].sort((a, b) => a - b);
    expect(percentileLinear(values, 0.95)).toBeCloseTo(95.05, 10);
    expect(percentileLinear(values, 0.95)).toBeCloseTo(sorted[94]! + 0.05 * (sorted[95]! - sorted[94]!), 10);
  });

  test("границы q = 0 и q = 1", () => {
    expect(percentileLinear([10, 20, 30], 0)).toBe(10);
    expect(percentileLinear([10, 20, 30], 1)).toBe(30);
    expect(percentileLinear([5], 0.5)).toBe(5);
  });

  test("входные данные не изменяются (копия перед сортировкой)", () => {
    const values = [3, 1, 2];
    percentileLinear(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  test("некорректные входы отклоняются", () => {
    expect(() => percentileLinear([], 0.5)).toThrow(/пустой массив/);
    expect(() => percentileLinear([1], 1.5)).toThrow(/q вне \[0, 1\]/);
    expect(() => percentileLinear([1, 2], -0.1)).toThrow(/q вне \[0, 1\]/);
    expect(() => percentileLinear([1, 2], Number.NaN)).toThrow(/q вне \[0, 1\]/);
  });
});

describe("документы содержат исправленные формулы", () => {
  test("протокол: Holm-adjusted p-values и разделение понятий", async () => {
    const text = await Bun.file(PROTOCOL).text();
    expect(text).toContain("p_adj_(2) = max(p_adj_(1), min(1, p_(2)))");
    expect(text).toContain("последовательные пороги Holm");
    expect(text).toContain("Holm-adjusted p-values");
    expect(text).toContain("p_adj_(2) ≥ p_adj_(1)");
  });

  test("протокол: индексация перцентиля с нуля и явная формула", async () => {
    const text = await Bun.file(PROTOCOL).text();
    expect(text).toContain("Индексация массива — с нуля");
    expect(text).toContain("q95 = sorted_values[94] + 0,05 × (sorted_values[95] − sorted_values[94])");
  });

  test("протокол и спецификация: основной метод p-value зафиксирован заранее", async () => {
    const protocol = await Bun.file(PROTOCOL).text();
    const spec = await Bun.file(SPEC).text();
    for (const text of [protocol, spec]) {
      expect(text).toContain("HAC");
      expect(text).toContain("фиксируется до test");
      expect(text).toContain("sensitivity");
    }
  });

  test("спецификация: монотонность adjusted p-values и перцентиль", async () => {
    const text = await Bun.file(SPEC).text();
    expect(text).toContain("p_adj_(2) ≥ p_adj_(1)");
    expect(text).toContain("sorted[94] + 0,05 × (sorted[95] − sorted[94])");
  });
});

// Исключение строго по списку: только исследовательский скрипт эксперимента Stage 3.4.5.
// Любой другой файл в src/ с этими именами по-прежнему считается нарушением.
const ALLOWED_RESEARCH_SCRIPTS = new Set<string>([
  "src/forecasting/analytics/adaptive-baseline/experiment.ts",
  "src/forecasting/analytics/adaptive-baseline/multi-horizon.ts",
  "src/forecasting/analytics/adaptive-baseline/stability.ts",
]);

describe("границы scope", () => {
  test("модуль statistics.ts отсутствует, production-код не зависит от него", async () => {
    const file = Bun.file("src/forecasting/analytics/diagnostics/statistics.ts");
    expect(await file.exists()).toBe(false);
    // ни один файл production-кода не импортирует локальные функции теста
    const glob = new Bun.Glob("src/**/*.ts");
    const offenders: string[] = [];
    for await (const path of glob.scan(".")) {
      const text = await Bun.file(path).text();
      const normalized = path.replace(/\\/g, "/");
      if (ALLOWED_RESEARCH_SCRIPTS.has(normalized)) continue;
      if (/holmAdjusted|percentileLinear|rejectByHolm|holmThresholds/.test(text)) offenders.push(normalized);
    }
    expect(offenders).toEqual([]);
    expect(ALLOWED_RESEARCH_SCRIPTS.size).toBe(3);
  });
});