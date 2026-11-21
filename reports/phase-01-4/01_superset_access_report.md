# Фаза 1.4.1 — Доступ к Superset (read-only)

Сгенерировано: 2026-11-21T15:49:44.551Z
***REMOVED***: `https://superset.svc.vkusvill.ru:443`
Credentials присутствуют: да (значения не выводятся).

## Итоговый статус: **ACCESS_OK**

## Слои

| Слой | OK | мс | Статус/код | Детали |
|---|---:|---:|---|---|
| dns.A | true | 43 | — | {"addresses":["10.210.254.19"]} |
| dns.AAAA | false | 8 | UNKNOWN | undefined |
| tcp | true | 78 | — | {"host":"superset.svc.vkusvill.ru","port":443} |
| tls | true | 31 | — | {"valid_to":"May 20 23:06:40 2027 GMT","issuer":"GlobalSign GCC R46 OV TLS CA 2025","subject":"*.svc.vkusvill.ru"} |
| http.GET_/health | true | 34 | 200 | {"preview_len":2} |

## Авторизация и spot checks

- auth attempted: true
- login: success
- error: —
- spot checks ok: true
  - dataset/4732: {"ok":true,"result_keys":42}
  - chart/28360: {"ok":true,"result_keys":22}
  - dashboard/1680: {"ok":true,"result_keys":28}

## Gate G1

G1 = PASS: массовый read-only сбор разрешён.
