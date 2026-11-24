// Stage 3.4.8.1: тесты hardening (R1 fail-closed reader, R2 interprocess lock).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";

import { readJsonl, ShadowStorageCorruptedError, isSnapshotRecord, storePaths, type ShadowSnapshot } from "../../src/forecasting/shadow/store";
import { acquireShadowLock, releaseShadowLock, isProcessAlive, SHADOW_LOCK_NAME } from "../../src/forecasting/shadow/lock";

function snapshot(id: string): Partial<ShadowSnapshot> {
  return {
    snapshot_id: id,
    run_id: "run-1",
    mode: "replay",
    model_id: "rolling_7_day_mean",
    model_version: "rolling-7-day-mean/v1",
    variant: null,
    horizon: 1,
    origin_date: "2026-01-01",
    target_date: "2026-01-02",
    forecast_value: 100,
    status: "OK",
    fallback_reason: null,
    input_data_version: "iv",
    dataset_checksum: "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a",
    generated_at: "2026-11-24T00:00:00.000Z",
  };
}

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dds-r1-"));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("R1 fail-closed JSONL reader", () => {
  test("R1-01 корректный файл читается полностью", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify(snapshot("a"))}\n${JSON.stringify(snapshot("b"))}\n`);
    const rows = await readJsonl<ShadowSnapshot>(path, isSnapshotRecord);
    expect(rows.length).toBe(2);
  });

  test("R1-02 повреждение в начале → line=1", async () => {
    const path = await tempFile("f.jsonl", `{broken\n${JSON.stringify(snapshot("a"))}\n`);
    await expect(readJsonl(path, isSnapshotRecord)).rejects.toThrow(ShadowStorageCorruptedError);
    try {
      await readJsonl(path, isSnapshotRecord);
    } catch (error) {
      const corrupted = error as ShadowStorageCorruptedError;
      expect(corrupted.code).toBe("SHADOW_STORAGE_CORRUPTED");
      expect(corrupted.line).toBe(1);
      expect(corrupted.file).toBe("f.jsonl");
    }
  });

  test("R1-03 повреждение в середине → точный номер строки", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify(snapshot("a"))}\n{broken\n${JSON.stringify(snapshot("b"))}\n`);
    try {
      await readJsonl(path, isSnapshotRecord);
      throw new Error("ожидалась ошибка");
    } catch (error) {
      expect((error as ShadowStorageCorruptedError).line).toBe(2);
    }
  });

  test("R1-04 повреждена последняя строка", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify(snapshot("a"))}\n{broken`);
    try {
      await readJsonl(path, isSnapshotRecord);
      throw new Error("ожидалась ошибка");
    } catch (error) {
      expect((error as ShadowStorageCorruptedError).line).toBe(2);
    }
  });

  test("R1-05 пустой файл → пустой массив (существующий контракт)", async () => {
    const path = await tempFile("f.jsonl", "");
    expect(await readJsonl(path, isSnapshotRecord)).toEqual([]);
  });

  test("R1-06 завершающий newline и пустые строки допустимы", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify(snapshot("a"))}\n\n`);
    expect((await readJsonl(path, isSnapshotRecord)).length).toBe(1);
  });

  test("R1-07 нет частичного результата при повреждении", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify(snapshot("a"))}\n${JSON.stringify(snapshot("b"))}\n{broken\n`);
    let caught: unknown = null;
    try {
      await readJsonl(path, isSnapshotRecord);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShadowStorageCorruptedError);
  });

  test("R1-08 неверная структура записи → ошибка валидации", async () => {
    const path = await tempFile("f.jsonl", `${JSON.stringify({ hello: "world" })}\n`);
    try {
      await readJsonl(path, isSnapshotRecord);
      throw new Error("ожидалась ошибка");
    } catch (error) {
      expect((error as ShadowStorageCorruptedError).reason).toContain("структура");
    }
  });

  test("R1-09 pipeline не пишет новые снапшоты при повреждении хранилища", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r1-"));
    const store = storePaths(dir);
    await writeFile(store.forecasts, `{broken\n`);
    const before = await readFile(store.forecasts, "utf8");
    const { reconcile } = await import("../../src/forecasting/shadow/pipeline");
    const rows = Array.from({ length: 5 }, (_, index) => ({ date: `2026-01-0${index + 1}`, value: 100 }));
    await expect(reconcile(rows, store, "run-x", "2026-11-24T00:00:00.000Z")).rejects.toThrow(ShadowStorageCorruptedError);
    expect(await readFile(store.forecasts, "utf8")).toBe(before);
    expect(existsSync(store.reconciliations)).toBe(false);
  });

  test("R1-10 CLI на повреждённом хранилище → exit 6, диагностика, без изменений", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r1-cli-"));
    const store = storePaths(dir);
    // две корректные строки, третья повреждена
    await writeFile(store.forecasts, `${JSON.stringify(snapshot("a"))}\n${JSON.stringify(snapshot("b"))}\n{broken\n`);
    await writeFile(store.reconciliations, `${JSON.stringify({ snapshot_id: "a", run_id: "r", model_id: "rolling_7_day_mean", horizon: 1, target_date: "2026-01-02", forecast_value: 1, actual: 1, absolute_error: 0, signed_error: 0, reconciled_at: "x" })}\n`);
    await writeFile(store.manifest, JSON.stringify({ version: "test-manifest", created_at: "2026-11-24T00:00:00.000Z" }));
    const hash = (path: string) => new Bun.CryptoHasher("sha256").update(require("node:fs").readFileSync(path)).digest("hex");
    const before = { forecasts: hash(store.forecasts), reconciliations: hash(store.reconciliations), manifest: hash(store.manifest) };

    const proc = Bun.spawn({
      cmd: ["bun", "src/forecasting/cli/shadow.ts", "--mode", "monitor"],
      cwd: process.cwd(),
      env: { ...process.env, DSH_SHADOW_STORE: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(code).not.toBe(0);
    expect(code).toBe(6);
    expect(stderr).toContain("SHADOW_STORAGE_CORRUPTED");
    expect(stderr).toContain("file=forecasts.jsonl");
    expect(stderr).toContain("line=3");
    // хранилище не изменено
    expect(hash(store.forecasts)).toBe(before.forecasts);
    expect(hash(store.reconciliations)).toBe(before.reconciliations);
    expect(hash(store.manifest)).toBe(before.manifest);
    // побочные файлы не созданы
    expect(existsSync(store.errors)).toBe(false);
    expect(existsSync(join(dir, SHADOW_LOCK_NAME))).toBe(false);
  });
});

describe("R2 interprocess lock", () => {
  test("R2-01 первый процесс захватывает lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(existsSync(result.path)).toBe(true);
      releaseShadowLock(result.path, result.token);
    }
  });

  test("R2-02 повторный захват при активном владельце → LOCKED, lock не удалён", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const first = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    expect(first.acquired).toBe(true);
    const second = acquireShadowLock(dir, "replay", "2026-11-24T00:00:01.000Z");
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.code).toBe("LOCKED");
    if (first.acquired) releaseShadowLock(first.path, first.token);
  });

  test("R2-03 штатное освобождение удаляет lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    if (!result.acquired) throw new Error("lock не захвачен");
    expect(releaseShadowLock(result.path, result.token)).toBe(true);
    expect(existsSync(result.path)).toBe(false);
    expect(acquireShadowLock(dir, "monitor", "2026-11-24T00:00:02.000Z").acquired).toBe(true);
  });

  test("R2-04 исключение во время работы → finally освобождает собственный lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const result = acquireShadowLock(dir, "all", "2026-11-24T00:00:00.000Z");
    if (!result.acquired) throw new Error("lock не захвачен");
    try {
      try {
        throw new Error("моделируемый сбой");
      } finally {
        releaseShadowLock(result.path, result.token);
      }
    } catch {
      // ожидаемо
    }
    expect(existsSync(result.path)).toBe(false);
  });

  test("R2-05 повреждённый lock → CORRUPTED_LOCK, файл сохраняется", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const path = join(dir, SHADOW_LOCK_NAME);
    await writeFile(path, "not-json");
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    expect(result.acquired).toBe(false);
    if (!result.acquired) expect(result.code).toBe("CORRUPTED_LOCK");
    expect(existsSync(path)).toBe(true);
  });

  test("R2-06 активный pid на том же hostname → LOCKED, lock не удалён", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const path = join(dir, SHADOW_LOCK_NAME);
    await writeFile(path, JSON.stringify({ pid: process.pid, hostname: hostname(), started_at: "2026-11-24T00:00:00.000Z", token: "owner-token", mode: "monitor" }));
    expect(isProcessAlive(process.pid)).toBe(true);
    const result = acquireShadowLock(dir, "replay", "2026-11-24T00:00:01.000Z");
    expect(result.acquired).toBe(false);
    if (!result.acquired) expect(result.code).toBe("LOCKED");
    expect(existsSync(path)).toBe(true);
  });

  test("R2-07 завершённый pid на том же hostname → контролируемое восстановление", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const path = join(dir, SHADOW_LOCK_NAME);
    await writeFile(path, JSON.stringify({ pid: 999999, hostname: hostname(), started_at: "2026-11-24T00:00:00.000Z", token: "stale-token", mode: "monitor" }));
    expect(isProcessAlive(999999)).toBe(false);
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:02.000Z");
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.recovered).toBe(true);
      releaseShadowLock(result.path, result.token);
    }
  });

  test("R2-08 другой hostname → автоматическое удаление запрещено", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const path = join(dir, SHADOW_LOCK_NAME);
    await writeFile(path, JSON.stringify({ pid: 1, hostname: "another-host", started_at: "2026-11-24T00:00:00.000Z", token: "foreign", mode: "monitor" }));
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    expect(result.acquired).toBe(false);
    if (!result.acquired) expect(result.code).toBe("STALE_AMBIGUOUS");
    expect(existsSync(path)).toBe(true);
  });

  test("R2-09 чужой token не удаляет lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const result = acquireShadowLock(dir, "monitor", "2026-11-24T00:00:00.000Z");
    if (!result.acquired) throw new Error("lock не захвачен");
    expect(releaseShadowLock(result.path, "чужой-token")).toBe(false);
    expect(existsSync(result.path)).toBe(true);
    releaseShadowLock(result.path, result.token);
  });

  test("R2-10/R2-11 два реальных процесса: второй получает LOCKED и не меняет хранилище", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const holder = Bun.spawn({
      cmd: ["bun", "-e", `
        const { acquireShadowLock } = require("C:/soft/bun/dds/src/forecasting/shadow/lock.ts");
        const r = acquireShadowLock(${JSON.stringify(dir)}, "monitor", new Date().toISOString());
        console.log(r.acquired ? "ACQUIRED" : "FAILED");
        await Bun.sleep(1200);
        if (r.acquired) require("C:/soft/bun/dds/src/forecasting/shadow/lock.ts").releaseShadowLock(r.path, r.token);
      `],
      stdout: "pipe",
      stderr: "pipe",
    });
    await Bun.sleep(400);
    const second = acquireShadowLock(dir, "replay", new Date().toISOString());
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.code).toBe("LOCKED");
    expect(existsSync(join(dir, "forecasts.jsonl"))).toBe(false);
    await holder.exited;
  });

  test("R2-12 аварийное завершение: последующий запуск выполняет recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-r2-"));
    const holder = Bun.spawn({
      cmd: ["bun", "-e", `
        const { acquireShadowLock } = require("C:/soft/bun/dds/src/forecasting/shadow/lock.ts");
        const r = acquireShadowLock(${JSON.stringify(dir)}, "monitor", new Date().toISOString());
        console.log(r.acquired ? "ACQUIRED" : "FAILED");
        await Bun.sleep(10000);
      `],
      stdout: "pipe",
      stderr: "pipe",
    });
    await Bun.sleep(500);
    // имитируем аварийное завершение: процесс убит без release
    holder.kill();
    await holder.exited;
    const recovered = acquireShadowLock(dir, "monitor", new Date().toISOString());
    expect(recovered.acquired).toBe(true);
    if (recovered.acquired) {
      expect(recovered.recovered).toBe(true);
      releaseShadowLock(recovered.path, recovered.token);
    }
  });
});