# Согласованность цепочки: агент → сервис → панель

Сверка 12 сентября 2026 по коду всех трёх сторон: `bpapi_agent` (Rust), `app/ai` (сервис,
TypeScript), `app/frontend` (панель «Администрирование 1С»). Проверялись не описания, а то, что
стороны действительно отправляют и читают.

**Итог: цепочка замкнута и согласована.** Расхождений, ломающих работу, не нашлось. Ниже — что
именно сверено и три места, которые стоит держать в виду.

---

## 1. Команды и права

28 админ-команд в whitelist сервиса — все 28 умеет агент. Сверены построчно `capability`,
`operation` и `requiresBase`:

| Группа | Способность | Совпадает |
|---|---|---|
| `CLUSTER_*` (10 команд) | `cluster.admin` | да |
| `IB_*` (14 команд) | `ib.admin` | да |
| `AGENT_LIST_PROCESSES`, `AGENT_KILL_PROCESS` | `agent.procs` | да |

`IB_BATCH` агент умеет, но сервис его намеренно не объявляет: групповая операция у панели — это
N отдельных команд с прогрессом по каждой базе. Пакетный режим остаётся для расписания агента.

## 2. Payload: поле в поле

Схемы сервиса `.strict()` — лишнее поле отвергается, недостающее не дойдёт. Проверены все
команды с непустым payload:

| Команда | Сервис принимает | Агент читает |
|---|---|---|
| `IB_CREATE_USER` | `name, fullName, password, roles, osUser, showInList` | те же |
| `IB_UPDATE_USER` | `name, newName, fullName, password, addRoles, removeRoles, roles, disabled, showInList` | те же (`addRoles`/`removeRoles` — с сегодняшней правки) |
| `IB_INSTALL_EXTENSION` | `name, contentBase64, safeMode` | те же |
| `IB_PUBLISH` / `IB_UNPUBLISH` | `alias, dir, webServer` / `alias, webServer` | те же |
| `IB_BACKUP` | `dir` | `dir` |
| `IB_CHECK` | `reindex, logicalIntegrity, recalcTotals, repair, dryRun` | те же |
| `IB_RESTORE` | `path, lockSessions, dryRun` | те же |
| `IB_APPLY_UPDATE` | `path, backup, lockSessions, dryRun` | те же |
| `CLUSTER_DROP_INFOBASE` | `confirm` | `confirm` |
| `CLUSTER_SET_SESSIONS_LOCK` | `enabled, message, from, to, permissionCode` | те же |
| `CLUSTER_TERMINATE_SESSION` / `CLUSTER_DISCONNECT` | `sessionId` / `connectionId` | те же |
| `AGENT_KILL_PROCESS` | `pid, force` | те же |

`baseKey` входит в схему и приходит внутри payload — агент читает его оттуда же.

## 3. Ответы: что агент кладёт и что сервис берёт

* **Срез баз.** Тип сервиса `BaseState` — `key, id, name, status, onecVersion, extVersion,
  sessionsCount, published, publishUrl, dbMissing` — совпадает с тем, что агент формирует и в
  ответе `CLUSTER_LIST_INFOBASES`, и в `bases[]` heartbeat. Трёхзначность (`true` / `false` /
  поля нет) выдержана обеими сторонами для публикации и для базы данных.
* **Срез публикаций.** `PublicationItem` — `key, name, published, url`; плюс `complete`,
  `source`, `lookedIn` на верхнем уровне. Всё это агент отдаёт, сервис читает, а по `source` и
  `lookedIn` пишет предупреждение в журнал, когда срез не сопоставился.
* **Сухой прогон.** Агент возвращает `{ok, dryRun, baseKey, plan: [строки]}`; панель показывает
  его через `planText` (массив строк) — перед каждой разрушающей операцией она сперва делает
  `dryRun: true` и показывает план человеку.
* **Публикация.** `IB_PUBLISH` → `url`; сервис по нему сразу ставит базе `published` и адрес, не
  дожидаясь среза.
* **Процессы.** `items[{pid, tool, what, base, ageSecs, orphan}]` — панель рисует их таблицей и
  переспрашивает при `AGENT_PROCESS_UNSAFE`.

## 4. Последний участок: кнопки в панели

Проверено, что каждая команда доходит до интерфейса, а не остаётся эндпойнтом:

| Команда | Экран |
|---|---|
| `IB_CHECK` | `BaseMaintenance.tsx`, групповые команды, расписание |
| `IB_RESTORE`, `IB_APPLY_UPDATE` | `BaseMaintenance.tsx` |
| `CLUSTER_DROP_INFOBASE` | `BaseAvailability.tsx` |
| `AGENT_LIST_PROCESSES`, `AGENT_KILL_PROCESS` | `ProcessesTab.tsx` |
| `IB_BACKUP` | групповые команды, расписание |

Мёртвых эндпойнтов и невызываемых команд не осталось.

## 5. Способности: две больше, чем знает whitelist

Агент объявляет пять: `cluster.admin`, `ib.admin`, `agent.procs`, `ib.auth`, `ib.echo`.
Тип `AgentCapability` в сервисе перечисляет три — и это НЕ расхождение: `ib.auth` и `ib.echo`
не гейтят команды, а говорят сервису о возможностях агента:

* **`ib.auth`** — «умею входить под учётной записью конкретной базы» (`onecRouter.ts`,
  `CAP_BASE_AUTH`; проверяется и в `batches.ts`);
* **`ib.echo`** — «прикладываю к изменяющей команде новое содержимое базы» (`agentRouter.ts`,
  `onec/echo.ts`). По его отсутствию панель показывает подсказку, что список обновится не сразу.

Обе стороны читают их как строки, поэтому расширение списка ничего не ломает.

---

## Что стоит держать в виду

### K1. Коды ошибок агента сервис не разбирает по коду — только по тексту

`errorHints.ts` сопоставляет ПОДСКАЗКИ по регулярным выражениям над текстом ошибки, а не по
коду. Поэтому `RAC_*`, `ONEC_*`, `IB_TIMEOUT`, `IB_UNAVAILABLE`, `IB_ROLE_NOT_FOUND` нигде не
упоминаются отдельно: до человека доходит `message`, а он у агента развёрнутый и с подсказкой,
что делать.

Работает это ровно до тех пор, пока тексты агента остаются объясняющими. Стоит помнить при
правке формулировок: короткое сообщение здесь теряет половину смысла, потому что кода никто не
читает.

Исключение — коды, по которым сервис принимает решения: `IB_DB_MISSING` (ставит признак «Нет в
СУБД»), `AGENT_PROCESS_UNSAFE` и `AGENT_PROCESS_NOT_FOUND` (панель переспрашивает),
`AGENT_INSTANCE_CONFLICT` (агент читает `ownerInstanceId` из `details`). Эти четыре — контракт,
и менять их нельзя.

### K2. Проверка намерения по эху работает только со свежим агентом

Сервис сличает намерение команды с эхом (`checkRoleIntent`) и не пропускает как успех ответ, в
котором роли не изменились. Проверка включается по способности `ib.echo`. У агента она есть, но
**сама правка ролей поправками появилась только сегодня** — до обновления на сервере команда
будет честно падать с `AGENT_ROLES_NOT_APPLIED`. Это признак необновлённого агента, а не
поломки.

### K3. Четыре команды не исполнялись ни разу

`IB_CHECK`, `IB_RESTORE`, `IB_APPLY_UPDATE`, `CLUSTER_DROP_INFOBASE` согласованы по всей
цепочке — схемы, эндпойнты, кнопки, сухой прогон, — но ни одна не выполнялась на живой базе.
Согласованность контрактов этого не заменяет: она гарантирует, что команда дойдёт, а не что
конфигуратор отработает как задумано.
