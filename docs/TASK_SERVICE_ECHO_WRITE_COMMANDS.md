# Задача сервиса и панели: применять эхо остальных изменяющих команд

> 14.09.2026. Агентская часть — [TASK_AGENT_ECHO_WRITE_COMMANDS.md](TASK_AGENT_ECHO_WRITE_COMMANDS.md)
> (E1–E6). У каждой задачи ниже есть **запасной путь без эха** — его можно делать сразу, не
> дожидаясь сборки агента.

## Правило

Изменение → в ответе новое состояние → реестр обновлён в тот же миг, когда команда стала `done` →
панель показывает результат без второй команды. Нет `state` — запасной путь: записать известное по
факту команды или поставить чтение, но **никогда не оставлять реестр в прежнем состоянии молча**.

Где сейчас: `parseEcho` (`ai/src/onec/echo.ts`) знает только `users`/`extensions`; остальное
применяется в `agentRouter.ts` по типам (`CLUSTER_LIST_INFOBASES`, `CLUSTER_CHECK_BASES`,
`IB_PUBLISH`/`IB_UNPUBLISH`); `REFRESH_AFTER` ставит чтение только для пользователей и расширений.

## S1 + P1. Блокировка начала сеансов (зависит от E1) — P1

**Факт.** Состояние блокировки не хранится нигде: в таблице `bases` нет полей, в `OnecBase` —
тоже. После «Заблокировать» вкладка «Сеансы» перечитывает список баз (`SessionsTab.tsx:176`), но
показать включена ли блокировка нечем.

**Сервис.**
1. Миграция `024_base_sessions_lock.sql`: `sessions_denied boolean` (NULL — не знаем),
   `sessions_denied_message text`, `sessions_denied_from text`, `sessions_denied_to text`,
   `sessions_denied_seen_at timestamptz`, `sessions_denied_source text CHECK IN ('cluster','command')`.
2. `bases.setSessionsLock(serverId, key, lock, source)` — прямой `UPDATE`, как `setPublication`
   (команда ЗНАЕТ результат: снятие обязано стереть сообщение).
3. `agentRouter`: `CLUSTER_SET_SESSIONS_LOCK` SUCCESS → есть `state.lock` — записать с
   `source = 'cluster'`, `seen_at = readAt`; нет — записать `enabled`/`message` из payload с
   `source = 'command'`.
4. `bases.sync`: поле `lock` в строке среза — применить (`COALESCE`: нет поля — прежнее знание).
5. API `OnecBase`: `sessionsDenied`, `sessionsDeniedMessage`, `sessionsDeniedFrom`,
   `sessionsDeniedTo`, `sessionsDeniedSeenAt`, `sessionsDeniedSource`.

**Панель.**
* «Сеансы»: у выбранной базы — `StateChip` «Вход заблокирован» с сообщением и окном; из двух кнопок
  доступна та, что меняет состояние (заблокированную — «Разблокировать»). `sessionsDenied === null` —
  обе, как сейчас.
* Карточка базы: строка «Блокировка сеансов» в «Основном» (`ValueRow`).
* После команды — `setQueryData(["onec","bases"])` из ответа, если в нём `state.lock`.
* `source = 'command'` — подпись «по последней команде из панели», как у «Показывать в списке выбора».

**Тесты.** Сервис: эхо → `cluster`; без эха → `command` из payload; срез без `lock` не затирает.
Панель: доступна одна кнопка по состоянию; `null` — обе.

## S2 + P2. Удаление регистрации базы (частично зависит от E2) — P1

**Факт.** После `CLUSTER_DROP_INFOBASE` реестр не меняется: база видна со статусом ONLINE/UNKNOWN до
полного среза.

**Сервис** (`agentRouter`, SUCCESS):
* есть `state.infobases` с `complete: true` → `bases.sync(serverId, items, { complete: true, authoritative: true })`;
* нет → **запасной путь сразу:** `bases.markMissing(serverId, key)` — `status = 'MISSING'`. Агент
  подтвердил удаление сам (он отказывает, если база данных на месте), это не догадка.

**Панель.** `BaseAvailability`: после удаления карточка показывает «Нет в кластере»; кнопка
удаления гаснет. Проверить, что список «Базы 1С» по умолчанию скрывает `MISSING` или помечает.

**Тесты.** Без эха → `MISSING`; с полным срезом → `sync`; неуспех → реестр не тронут.

## S3 + P3. Загрузка из выгрузки и обновление конфигурации (частично зависит от E3, E4) — P1

**Факт.** `IB_RESTORE` и `IB_APPLY_UPDATE` реестр не трогают; панель (`BaseMaintenance.tsx`)
показывает тост. Версии конфигурации в реестре нет: `onec_version` — версия ПЛАТФОРМЫ (`8.3.25…`).

**Сервис.**
1. Миграция (в ту же 024 или 025): `bases.config_name text`, `config_version text`,
   `config_seen_at timestamptz`.
2. `parseEcho`: понимать `state.config` (`name`, `version`, `readAt`); `users`/`extensions` уже есть.
3. `agentRouter`, SUCCESS, не `dryRun`:
   * эхо `users`/`extensions` → `syncUsers`/`syncExtensions` (общий путь уже есть);
   * `state.config` → `bases.setConfig(serverId, key, config)`;
   * **запасной путь сразу:** `REFRESH_AFTER` расширить до списка —
     `IB_RESTORE: ["IB_LIST_USERS", "IB_LIST_EXTENSIONS"]`, `IB_APPLY_UPDATE: ["IB_LIST_EXTENSIONS"]`
     (чтение ставится только для того, чего эхо не принесло); у `IB_APPLY_UPDATE` без
     `state.config` записать `versionTo` из ответа (`config_seen_at` = время команды).
4. API `OnecBase`: `configName`, `configVersion`, `configSeenAt`.

**Панель.** Карточка базы: «Конфигурация: имя, версия» в «Основном». После загрузки и обновления —
ничего специально: реестр уже новый, `refreshAfterWork` перечитает.

**Тесты.** `parseEcho` с `config`; `REFRESH_AFTER` ставит только недостающее; `dryRun` ничего не
ставит; `versionTo` без эха записывается.

## S4 + P4. Снятие процесса агента (частично зависит от E5) — P2

**Факт.** `ProcessesTab.tsx:81` после снятия перечитывает снимок из heartbeat
(`fetchAgentProcesses(false)`) — снятый процесс остаётся в таблице до следующего heartbeat.

**Сервис.** `AGENT_KILL_PROCESS` SUCCESS с `state.processes` → `agents.setProcesses(agentId, items)`;
в ответе панели оставить `state`.

**Панель.** Есть `state.processes` → `setQueryData(["onec","agent-processes"], { items })`;
**нет — запасной путь сразу:** `fetchAgentProcesses(true)` (живое чтение), а не снимок.
`stillRunning` — предупреждение вместо «процесс снят».

## S5. Публикация (зависит от E6) — P3

`state.publication` → `setPublication(serverId, key, published, url)` и `publish_seen_at = readAt`;
нет эха — как сейчас (по факту команды).

## Порядок

| Сразу, без агента | После сборки агента |
|---|---|
| S2 (`markMissing`), S3 (чтение после + `versionTo`), S4 (живое чтение), миграции S1/S3 и поля API | S1 целиком (E1), S2 со срезом (E2), S3 с эхом (E3/E4), S4 с эхом (E5), S5 (E6) |

## Как проверить

1. Блокировка → чип «Вход заблокирован» сразу, без «Обновить»; снять → чип пропал.
2. Удаление мёртвой регистрации → в списке «Нет в кластере» сразу.
3. Загрузка `_transition` из выгрузки → «Пользователи» показывают пользователей выгрузки без «Проверить».
4. Обновление конфигурации копии → версия в карточке новая.
5. Снятие процесса → строки нет сразу.

---

## Сделано — 14.09 (сервис и панель)

| № | Что | Где |
|---|---|---|
| S1 + P1 | миграция `024_base_state_echo.sql` (`sessions_denied*`, источник `cluster`/`command`); `bases.setSessionsLock`; блокировка из эха (E1) и из строки среза (`lock`), без эха — по payload команды; API `sessionsDenied*`. «Сеансы»: метка «Вход закрыт/открыт/не проверялся», кнопка одна по известному состоянию; эхо «не изменилось» — предупреждение. Карточка базы: метка и строка «Блокировка сеансов» | `onec/writeState.ts`, `bases/service.ts`, `agentRouter.ts`, `models/OneCAdmin/sessionsLock.ts`, `SessionsTab.tsx`, `OneCBases/index.tsx` |
| S2 + P2 | полный срез из эха (E2) → `bases.sync`; без него → `bases.markMissing` (статус «Нет в кластере») | `writeState.ts`, `bases/service.ts` |
| S3 + P3 | `config_name`/`config_version`/`config_seen_at`; эхо `state.config` (E3/E4) → `bases.setConfig`; обновление без эха — `versionTo`; чтения после — `readsAfter` вместо `REFRESH_AFTER` (загрузка: пользователи и расширения, обновление: расширения — только то, чего эхо не принесло; `dryRun` — ничего). Карточка базы: строка «Конфигурация» | `writeState.ts`, `agentRouter.ts`, `OneCBases/index.tsx` |
| S4 + P4 | `state.processes` (E5) → `agents.setProcesses`; живое чтение `AGENT_LIST_PROCESSES` тоже сохраняется снимком. «Процессы»: с эхом — перечитать снимок, без эха — живое чтение; `stillRunning` — предупреждение | `writeState.ts`, `agentRouter.ts`, `ProcessesTab.tsx` |
| S5 | `state.publication` (E6) → `setPublication` с `readAt`; без эха — по факту команды, как было | `writeState.ts`, `agentRouter.ts` |

Тесты: `ai/tests/write_state.test.ts` (8), `frontend/src/__tests__/onecSessionsLock.test.ts` (3).
Развернуть: `pm2 restart all` — миграция 024 применится при старте сервиса.
Не покрыто тестом: SQL новых методов реестра (проверяется живым сценарием «Как проверить»).
