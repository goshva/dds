// Stage 3.4.5: валидатор спецификации и протокола адаптивного baseline (версия v2).
// Проверяет обязательные методологические решения: иерархию эксперимента, Holm-коррекцию,
// формализацию разности ошибок, шумовой контроль, диагностику дублирования и правило выбора.
import { describe, expect, test } from "bun:test";

const SPEC = "docs/forecasting/contracts/adaptive-baseline-spec.md";
const PROTOCOL = "docs/forecasting/contracts/adaptive-baseline-protocol.md";

async function read(path: string): Promise<string> {
  const file = Bun.file(path);
  expect(await file.exists(), path).toBe(true);
  return file.text();
}

describe("спецификация: формула и иерархия", () => {
  test("фиксирует baseline, формулу, профиль по истории до origin и основную конфигурацию", async () => {
    const text = await read(SPEC);
    for (const required of [
      "rolling_7_day_mean",
      "clip(alpha * weight(d), ±limit)",
      "history_until_origin",
      "≤ origin_date",
      "alpha = 1.0",
      "limit = 10 %",
      "горизонт **7**",
      "step-exact",
      "min_train = 28",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  test("задаёт иерархию: дополнительные результаты не заменяют основной критерий", async () => {
    const text = await read(SPEC);
    expect(text).toContain("Дополнительные результаты **не заменяют** основной критерий");
    expect(text).toContain("Победитель не объявляется по большинству удачных дополнительных метрик");
    expect(text).toContain("варианты **A и B**");
  });

  test("содержит два варианта поправки и запрет смешивания", async () => {
    const text = await read(SPEC);
    expect(text).toContain("A — понедельник и суббота");
    expect(text).toContain("B — полный недельный профиль");
    expect(text).toContain("результаты не смешиваются");
  });
});

describe("спецификация: статистика и контроль", () => {
  test("фиксирует семейство основных сравнений и поправку Holm", async () => {
    const text = await read(SPEC);
    expect(text).toContain("Семейство основных сравнений");
    expect(text).toContain("{A, B} × {h = 7} × {min_train = 28}");
    expect(text).toContain("Holm");
    expect(text).toContain("exploratory");
  });

  test("формализует разность ошибок D_i и параметры интервала", async () => {
    const text = await read(SPEC);
    for (const required of [
      "D_i = |error_baseline_i| − |error_candidate_i|",
      "Положительное `D_i` означает улучшение",
      "HAC",
      "moving block bootstrap",
      "длина 7 дней",
      "10 000",
      "20261124",
      "перемешивание",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  test("требует 100 детерминированных seed и фиксацию амплитуды шума", async () => {
    const text = await read(SPEC);
    expect(text).toContain("100 детерминированных seed: 1…100");
    expect(text).toContain("медиана `|поправки|` варианта A на validation");
    expect(text).toContain("шум не использует фактические значения целевого дня");
    expect(text).toContain("percentile(D_noise, 95)");
  });

  test("требует диагностику дублирования информации", async () => {
    const text = await read(SPEC);
    for (const required of [
      "корреляция `weight(d)` с текущим уровнем",
      "распределение поправки в заказах",
      "распределение поправки в процентах",
      "стабильность знака поправки по кварталам",
      "поведение при растущем и снижающемся уровне",
      "|r| > 0,8",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  test("фиксирует детерминированное правило выбора параметров", async () => {
    const text = await read(SPEC);
    expect(text).toContain("sensitivity grid оценивается **только** на validation");
    expect(text).toContain("минимум MAE на validation; при равенстве — меньший `alpha`, затем меньший `limit`");
    expect(text).toContain("`config_hash`");
    expect(text).toContain("test используется **один раз**");
    expect(text).toContain("новый `experiment_id`");
    expect(text).toContain("Ручной выбор конфигурации после просмотра тестовых результатов запрещён");
  });
});

describe("протокол: разделение, критерии и артефакты", () => {
  test("разделяет валидационный и тестовый интервалы", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("первые 50 % origin");
    expect(text).toContain("последние 50 % origin");
    expect(text).toContain("пересечение интервалов");
    expect(text).toContain("запрещено");
  });

  test("задаёт основное семейство, Holm и exploratory-пометку", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("основное");
    expect(text).toContain("Holm");
    expect(text).toContain("exploratory");
  });

  test("задаёт критерии приёмки с D, Holm и шумовым перцентилем", async () => {
    const text = await read(PROTOCOL);
    for (const required of [
      "среднее `D_calendar > 0`",
      "**описательная** метрика",
      "`p_adj < 0,05`",
      "WAPE не ухудшается более чем на 1 процентный пункт",
      "|Bias| не возрастает",
      "min_train = 21",
      "`D_calendar > percentile(D_noise, 95)`",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  test("требует 100 шумовых прогонов и сохраняет seed/amplitude/checksum", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("100 шумовых прогонов (seed 1…100)");
    expect(text).toContain("`seed`, `amplitude`, `config_hash`, MAE, WAPE, Bias, checksum");
    expect(text).toContain("noise-control.csv");
  });

  test("требует контроль тождественности при alpha = 0", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("`alpha = 0`");
    expect(text).toContain("тождественность baseline");
  });

  test("перечисляет артефакты эксперимента", async () => {
    const text = await read(PROTOCOL);
    for (const artifact of [
      "specification.md",
      "config.json",
      "validation-selection.json",
      "duplication-diagnostics.json",
      "noise-control.csv",
      "forecast-details.csv",
      "model-comparison.csv",
      "paired-differences.csv",
      "leakage-check.json",
      "reproducibility.json",
      "final-report.md",
    ]) {
      expect(text, artifact).toContain(artifact);
    }
  });

  test("запрещает перемешивание при бутстрэпе и внешние факторы", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("перемешивать наблюдения при бутстрэпе");
    expect(text).toContain("использовать внешние факторы");
    expect(text).toContain("commit, push, reset, rebase, checkout");
  });

  test("допускает отрицательный результат как полноценный", async () => {
    const text = await read(PROTOCOL);
    expect(text).toContain("Отрицательный результат считается полноценным результатом этапа");
  });
});

describe("границы этапа", () => {
  test("документы не содержат реализации модели", async () => {
    const spec = await read(SPEC);
    const protocol = await read(PROTOCOL);
    expect(spec).not.toContain("class Adaptive");
    expect(protocol).not.toContain("class Adaptive");
    expect(spec).toContain("`naive_yesterday`, `weekly_seasonal_naive` (не изменяются)");
  });
});
describe("уточнения v3: шумовой контроль и Holm", () => {
  test("направление сравнения с шумом задано через D и перцентиль", async () => {
    const protocol = await read(PROTOCOL);
    const spec = await read(SPEC);
    for (const text of [protocol, spec]) {
      expect(text).toContain("D_calendar = MAE_baseline − MAE_calendar");
      expect(text).toContain("D_noise[j] = MAE_baseline − MAE_noise[j]");
      expect(text).toContain("D_calendar > percentile(D_noise, 95)");
    }
  });

  test("шум воспроизводится по seed и не зависит от фактических значений", async () => {
    const protocol = await read(PROTOCOL);
    expect(protocol).toContain("mulberry32");
    expect(protocol).toContain("seed = `j`");
    expect(protocol).toContain("использует фактические значения целевого дня");
  });

  test("требуются одинаковые evaluation pairs и блокировка при несовпадении", async () => {
    const protocol = await read(PROTOCOL);
    expect(protocol).toContain("том же** множестве пар");
    expect(protocol).toContain("блокируется");
    expect(protocol).toContain("INCONCLUSIVE");
  });

  test("перцентиль считается детерминированно", async () => {
    const protocol = await read(PROTOCOL);
    expect(protocol).toContain("94,05");
    expect(protocol).toContain("линейная интерполяция");
  });

  test("Holm: два сравнения, исходные и скорректированные p, правило p_adj", async () => {
    const protocol = await read(PROTOCOL);
    for (const required of [
      "p_adj_(1) = min(1, 2 × p_(1))",
      "p_adj_(2) = max(p_adj_(1), min(1, p_(2)))",
      "p_adj < 0,05",
      "исходные p-value",
      "скорректированные Holm p-value",
      "отдельно для варианта A и отдельно для варианта B",
    ]) {
      expect(protocol, required).toContain(required);
    }
  });

  test("CI объявлен описательной метрикой, а не единственным критерием", async () => {
    const protocol = await read(PROTOCOL);
    expect(protocol).toContain("**описательная** метрика");
    expect(protocol).toContain("Решени");
    expect(protocol).toContain("принимается только по `p_adj < 0,05`");
    expect(protocol).toContain("Нескорректированный CI нельзя использовать как единственное доказательство");
  });

  test("победитель не объявляется при p_adj >= 0,05", async () => {
    const protocol = await read(PROTOCOL);
    expect(protocol).toContain("объявлять победителя при `p_adj >= 0,05`");
  });
});