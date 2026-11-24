// UI-2: тесты API-клиента (без подстановки demo-данных).
import { describe, expect, test } from "bun:test";

import { ApiClient, ApiClientError } from "../../src/web/api/client";

const realFetch = globalThis.fetch;

describe("API-клиент", () => {
  test("успешный ответ возвращается как есть", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: "ok", data: { days: 906 }, meta: { generatedAt: "2026-11-24T00:00:00.000Z", source: "canonical_csv", readOnly: true } }), { status: 200 })) as unknown as typeof fetch;
    try {
      const client = new ApiClient();
      const result = await client.get<{ days: number }>("/api/v1/overview");
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.data.days).toBe(906);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("not_available не подменяется данными", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: "not_available", data: null, meta: { generatedAt: "x", source: "shadow_jsonl", readOnly: true, reason: "SHADOW_STORE_EMPTY" } }), { status: 200 })) as unknown as typeof fetch;
    try {
      const result = await new ApiClient().get("/api/v1/shadow/forecasts");
      expect(result.status).toBe("not_available");
      if (result.status === "not_available") expect(result.data).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("некорректный JSON → INVALID_JSON", async () => {
    globalThis.fetch = (async () => new Response("<html>error</html>", { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(new ApiClient().get("/api/v1/history")).rejects.toThrow(ApiClientError);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("сетевая ошибка → NETWORK_ERROR, timeout → TIMEOUT", async () => {
    try {
      globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
      await expect(new ApiClient().get("/api/v1/history")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
      globalThis.fetch = (async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }) as unknown as typeof fetch;
      await expect(new ApiClient().get("/api/v1/history")).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("параметры кодируются, пустые не отправляются", async () => {
    let called = "";
    globalThis.fetch = (async (input: string) => { called = String(input); return new Response(JSON.stringify({ status: "ok", data: {}, meta: { generatedAt: "x", source: "s", readOnly: true } })); }) as unknown as unknown as typeof fetch;
    try {
      await new ApiClient({ baseUrl: "http://127.0.0.1:8787" }).get("/api/v1/history", { limit: 10, from: undefined, to: "2026-11-23" });
      expect(called).toContain("limit=10");
      expect(called).toContain("to=2026-11-23");
      expect(called).not.toContain("from=");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});