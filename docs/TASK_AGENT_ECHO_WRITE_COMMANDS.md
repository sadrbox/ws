# Задача агента: эхо состояния у остальных изменяющих команд

> 14.09.2026. Продолжение `TASK_FRESH_STATE_AFTER_COMMAND.md` (эхо `users`/`extensions`,
> сеансов и соединений). Сервис и панель — [TASK_SERVICE_ECHO_WRITE_COMMANDS.md](TASK_SERVICE_ECHO_WRITE_COMMANDS.md).

## Зачем

Правило, которое уже работает у пользователей и расширений: **изменяющая команда прикладывает
к ответу новое состояние того, что изменила**. Тогда панель показывает результат сразу, без
второй команды и без устаревшего кэша.

Сверка 14.09 по всем изменяющим командам:

| Команда | Сейчас отвечает | Что остаётся устаревшим |
|---|---|---|
| `IB_CREATE_USER` / `IB_UPDATE_USER` / `IB_DELETE_USER` | `state.users` | — |
| `IB_INSTALL_EXTENSION` / `IB_DELETE_EXTENSION` | `state.extensions` | — |
| `CLUSTER_TERMINATE_SESSION` / `CLUSTER_DISCONNECT` | `state.sessions` / `state.connections` | — |
| **`CLUSTER_SET_SESSIONS_LOCK`** | `{ok}` | блокировку нельзя увидеть нигде: её не отдаёт ни одна команда |
| **`CLUSTER_DROP_INFOBASE`** | `{ok, baseKey, note}` | база остаётся в списке до следующего «Обновить из кластера» |
| **`IB_RESTORE`** | `{ok, path, transport}` | содержимое базы заменено, а пользователи и расширения в реестре — от прежней |
| **`IB_APPLY_UPDATE`** | `{ok, versionFrom, versionTo, backupPath}` | версия конфигурации нигде не хранится; расширения после обновления не перечитаны |
| `AGENT_KILL_PROCESS` | `{ok, note}` | панель перечитывает снимок процессов из heartbeat — снятый процесс виден до следующего heartbeat |
| `IB_PUBLISH` / `IB_UNPUBLISH` | `{ok, url}` / `{ok}` | состояние записано по факту команды, веб-сервер не перечитан |
| `IB_CHECK`, `IB_BACKUP` | отчёт / путь | базу не меняют — эхо не нужно |

## Общие правила (как у `state.users`)

* Состояние читается **после** изменения, в том же проходе, и кладётся в `state.<что>`.
* У списков — `complete: true` и `readAt`. **Перечитать не удалось — `state` не шлём вовсе**:
  команда при этом успешна, сервис поставит чтение или запишет факт сам. Неполное состояние хуже
  отсутствующего: сервис замещает им реестр.
* **`dryRun` — без `state`**: ничего не изменилось.
* **Секреты не возвращаются никогда** (код разрешения входа, пароли).
* Отдельная способность не нужна: сервис и панель смотрят на наличие `state`, как у сеансов.

## E1. `CLUSTER_SET_SESSIONS_LOCK` → `state.lock` — P1

```jsonc
{ "ok": true,
  "state": { "lock": {
      "enabled": true,                       // блокировка начала сеансов включена
      "message": "Обслуживание до 19:00",   // "" если нет
      "from": "2026-09-14T18:00:00", "to": "2026-09-14T19:00:00",  // null если окна нет
      "scheduledJobsDenied": false,          // если rac отдаёт — иначе поле не шлём
      "permissionCodeSet": true,             // сам код НЕ возвращаем
      "readAt": "2026-09-14T12:40:03Z" } } }
```

Читать `rac infobase info` после `update`. **Тот же объект — в каждой строке
`CLUSTER_LIST_INFOBASES`** (поле `lock`), если он доступен без входа в базу: иначе состояние,
выставленное в консоли кластера мимо панели, не будет видно никогда. Недоступен без
учётных данных ИБ — поле `lock` в срезе не шлём (не `enabled: false`).

## E2. `CLUSTER_DROP_INFOBASE` → `state.infobases` — P1

После удаления регистрации прочитать список баз кластера и приложить **ровно то, что отдаёт
`CLUSTER_LIST_INFOBASES`**, с `complete: true`, если ответили все кластеры сервера:

```jsonc
{ "ok": true, "baseKey": "aibek", "note": "…",
  "state": { "infobases": { "items": [ /* как у CLUSTER_LIST_INFOBASES */ ], "complete": true,
                            "readAt": "…", "stillListed": false } } }
```

`stillListed: true` — удаление прошло, но запись ещё в списке (перечитывать до 4 раз с паузой
0,4 с, как у сеансов).

## E3. `IB_RESTORE` → `state.users`, `state.extensions`, `state.config` — P1

После загрузки выгрузки — те же списки, что у `IB_LIST_USERS` / `IB_LIST_EXTENSIONS`, и
конфигурация базы:

```jsonc
"state": {
  "users":      { "items": [ … ], "complete": true, "readAt": "…" },
  "extensions": { "items": [ … ], "complete": true, "readAt": "…" },
  "config":     { "name": "БухгалтерияДляКазахстана", "version": "3.0.45.2", "readAt": "…" } }
```

Каждый блок — независимо: не удалось прочитать расширения — нет `extensions`, остальное шлём.

## E4. `IB_APPLY_UPDATE` → `state.config`, `state.extensions` — P1

`state.config` — прочитанная ПОСЛЕ обновления (не `versionTo` из файла: применение может
остановиться на промежуточной версии). `state.extensions` — расширения после обновления
(они могли стать неприменимыми). `versionFrom`/`versionTo` в ответе оставить как есть.

## E5. `AGENT_KILL_PROCESS` → `state.processes` — P2

```jsonc
{ "ok": true, "note": "…",
  "state": { "processes": { "items": [ /* как у AGENT_LIST_PROCESSES */ ], "readAt": "…",
                            "stillRunning": false } } }
```

`stillRunning: true` — сигнал отправлен, процесс ещё в списке.

## E6. `IB_PUBLISH` / `IB_UNPUBLISH` → `state.publication` — P3

Прочитать публикацию с веб-сервера после операции: `{ "published": true, "url": "…",
"webServer": "apache24", "readAt": "…" }`. Для снятия — `published: false, url: null`.
Не удалось прочитать — `state` нет, сервис запишет по факту команды, как сейчас.

## Тесты агента

На каждую команду: успех → `state` той формы, что у соответствующего чтения; перечитать не
удалось → `ok: true` без `state`; `dryRun` → без `state`; в `state.lock` нет кода разрешения.

## Как проверить на `_transition`

1. Блокировка из панели → в ответе `state.lock.enabled: true` и сообщение; снять → `false`.
2. Загрузка выгрузки (только `_transition`) → в ответе пользователи и расширения ВЫГРУЗКИ.
3. Снятие процесса → в `state.processes` его нет (или `stillRunning: true`).
4. `CLUSTER_DROP_INFOBASE` на мёртвой регистрации → в `state.infobases` базы нет.

---

## Сделано в агенте (сборка 2026-09-14 01:35, с дополнениями аудита R7)

| № | Что в ответе | Отличие от задачи |
|---|---|---|
| E1 | `state.lock {enabled, message, from, to, scheduledJobsDenied?, permissionCodeSet, readAt}` — `rac infobase info` после `update` | — |
| E1, срез | поле `lock` в строке `CLUSTER_LIST_INFOBASES` | `infobase info` требует администратора базы, поэтому блокировки читает **фон** под служебной учётной записью: до 20 баз в минуту, база раз в 10 мин, отказ — пауза 6 ч. В срез идёт прочитанное не старше 30 мин, иначе поля нет |
| E2 | `state.infobases {items, complete, readAt, stillListed}` | удалена последняя база кластера — эха нет: пустой срез агент успехом не отдаёт |
| E3 | `state.users`, `state.extensions`, `state.config {name, version, synonym?, readAt}` | одним входом в базу; служебного админа в выгрузке нет — вторая попытка под `payload.auth`; расширения без COM — через `ibcmd` |
| E4 | `state.config`, `state.extensions` **и `state.users`** (R7-А5: роли, которых нет в новой конфигурации) | `version: null`, если версия у конфигурации не задана |
| E5 | `state.processes {items, readAt, stillRunning}` | **также у `AGENT_CANCEL_COMMAND`** при `killed: true` (R7-А6) |
| E6 | `state.publication {published, url, webServer, readAt}` | только IIS (`appcmd`); у Apache эха нет — снятие не удаляет `default.vrd`, проверить нечем |
| R7-А3 | `CLUSTER_DISCONNECT`: к `state.connections` добавлен `state.locks {items, complete, readAt}` по всему кластеру | в задаче не было; таблица «Блокировки» на той же вкладке панели |

Попутно:

* `stillListed` у эха после снятия приходит всегда, `false` тоже.
* `CLUSTER_INFOBASE_INFO` больше **не отдаёт `permissionCode`** (код разрешения входа открытым
  текстом) — только `permissionCodeSet`.
* После `IB_PUBLISH` / `IB_UNPUBLISH` кэш публикаций агента сбрасывается: срез баз в ближайшие
  5 минут не вернёт прежнее `published`.
* После удаления регистрации агент забывает знание о базе данных и блокировке этой базы.
* После обслуживания с блокировкой (`IB_RESTORE`, `IB_APPLY_UPDATE`) блокировка в кэше
  перечитывается сразу.

**Сервису.** `parseEcho` понимает только `users` / `extensions`; `lock`, `infobases`, `config`,
`processes`, `publication`, `locks` остаются в результате команды — применять по S1–S5
(`TASK_SERVICE_ECHO_WRITE_COMMANDS.md`). `state.locks` панель может взять так же, как
`state.connections`.

**Проверить на сервере — окно блокировки.** При снятии агент передаёт только
`--sessions-deny=off`, а при включении без окна не стирает прежнее. Если в `state.lock` после
«Разблокировать» и повторного «Заблокировать» видны старые `from`/`to` из прошлой блокировки,
включение «без окна» на деле не действует — это задача агенту (правка аргументов `rac`).
