/**
 * Этап 1.6.2 — наблюдение за сетью/VPN.
 * Фиксирует моменты потери и восстановления соединения с Superset, повторяя безопасные GET.
 * Пишет reports/phase-01-6-2/evidence/connectivity_watch.json (идемпотентно).
 */
import { loadConfig } from "../config";
import { join } from "node:path";
import { ensureDir, nowIso, writeJson } from "./utils";

const OUT = join("reports", "phase-01-6-2", "evidence", "connectivity_watch.json");
const MAX_ROUNDS = Number(Bun.env.NETWATCH_ROUNDS ?? 40);
const INTERVAL_MS = Number(Bun.env.NETWATCH_INTERVAL_MS ?? 15000);

type Attempt = { at: string; ok: boolean; status: number | null; ms: number; error: string | null };

async function probe(baseUrl: string): Promise<Attempt> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    return { at: nowIso(), ok: res.ok, status: res.status, ms: Date.now() - t0, error: res.ok ? null : text.slice(0, 200) };
  } catch (e: any) {
    return { at: nowIso(), ok: false, status: null, ms: Date.now() - t0, error: String(e?.message ?? e) };
  }
}

async function main() {
  const cfg = loadConfig();
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const state: any = {
    base_url: baseUrl,
    started_at: nowIso(),
    lost_at: null,
    restored_at: null,
    attempts: [] as Attempt[],
    note: "VPN/сеть проверяются только штатными HTTPS-запросами к Superset; RBAC не обходится.",
  };

  let wasOk: boolean | null = null;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const a = await probe(baseUrl);
    state.attempts.push(a);
    if (wasOk === null) {
      wasOk = a.ok;
      if (!a.ok) state.lost_at = a.at;
      if (a.ok) state.restored_at = a.at;
    } else if (!wasOk && a.ok) {
      state.restored_at = a.at;
      wasOk = true;
    } else if (wasOk && !a.ok) {
      state.lost_at = a.at;
      wasOk = false;
    }
    ensureDir(join("reports", "phase-01-6-2", "evidence"));
    writeJson(OUT, state);
    console.log(`[netwatch] ${a.at} ok=${a.ok} status=${a.status} ms=${a.ms} ${a.error ?? ""}`);
    if (a.ok) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  state.finished_at = nowIso();
  writeJson(OUT, state);
}

main().catch((e) => {
  console.error("[netwatch] FAILED", e);
  process.exitCode = 1;
});
