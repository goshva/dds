/**
 * Этап 1.6.2 — оркестратор: синхронизация → доступ → значения → анализ → документы → валидация.
 * Каждый шаг идемпотентен; при сетевой ошибке уже сохранённые результаты не теряются.
 */
const steps = [
  ["sync", "src/phase1-6-2/sync.ts"],
  ["access", "src/phase1-6-2/access.ts"],
  ["values", "src/phase1-6-2/values.ts"],
  ["analysis", "src/phase1-6-2/analysis.ts"],
  ["docs", "src/phase1-6-2/docs.ts"],
  ["validate", "src/phase1-6-2/validate.ts"],
] as const;

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

for (const [name, file] of steps) {
  if (only.length && !only.includes(name)) continue;
  console.log(`\n=== ${name} ===`);
  const proc = Bun.spawnSync(["bun", file], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error(`[run] step ${name} failed with exit ${proc.exitCode}`);
    process.exit(proc.exitCode ?? 1);
  }
}
console.log("\n[run] all steps completed");
