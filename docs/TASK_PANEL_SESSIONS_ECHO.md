# Задача панели: список сеансов и соединений — из ответа на снятие

> 13.09.2026. Агент готов: сборка `0.1.0+2026-09-13 12:12 (+05)` и новее. Сервису правок не нужно.
>
> **Статус 13.09, 15:37: сделано в коде** (14:51): `models/OneCAdmin/clusterEcho.ts`, `SessionsTab`,
> `ConnectionsTab`, строка `onecSessionStillListed`, тест `onecClusterEcho.test.ts`. Сверено с
> описанным ниже — совпадает, включая правило «решает последнее успешное снятие». Не проведена
> живая проверка (раздел «Как проверить», пункты 2–4).
> Спецификация: `TASK_FRESH_STATE_AFTER_COMMAND.md` (таблица «Что к чему приложено» и заметка под
> ней), контракт — `ONEC_AGENT_CLUSTER_CONTRACT.md`, раздел «Эхо состояния».

## Что сейчас

* «Сеансы» → «Завершить сеанс» / «Завершить сеансы»: после команды `sessions.refetch()`
  (`frontend/src/models/OneCAdmin/SessionsTab.tsx:101` и `:136`).
* «Соединения» → «Разорвать»: после команды `connections.refetch()` (`ConnectionsTab.tsx:73`).

Каждый `refetch` — вторая команда агенту (`CLUSTER_LIST_SESSIONS` / `CLUSTER_LIST_CONNECTIONS`):
ещё одно место в его очереди и ещё один проход `rac` ради списка, который агент мог прочитать
сразу после снятия.

## Что теперь отвечает агент

```jsonc
// POST /v1/onec/sessions/:id/terminate → data
{ "ok": true, "sessionId": "…",
  "state": { "sessions": {
      "items": [ /* строки ровно как у GET /v1/onec/sessions (весь кластер) */ ],
      "complete": true,
      "readAt": "2026-09-13T06:40:12Z",
      "stillListed": true            // только если снятый сеанс ещё в списке
  } } }

// POST /v1/onec/connections/:id/disconnect → data
{ "ok": true, "connectionId": "…", "processId": "…",
  "state": { "connections": { "items": [ … ], "complete": true, "readAt": "…" } } }
```

Правила:

* **Список — всего кластера**, форма строк та же, что у `fetchSessions()` / `fetchConnections()`
  без `baseKey`. Им можно ЦЕЛИКОМ заменить данные запросов `["onec","sessions"]` и
  `["onec","connections"]`. Отбор по базе в «Сеансах» работает на месте по `infobase` и от этого не
  меняется.
* **`state` есть — значит, список полный** (ответили все кластеры сервера). Агент не дочитал —
  `state` нет вовсе; тогда перечитать, как сейчас. Старый агент — тоже `state` нет.
* **`stillListed: true`** — снятие прошло, но менеджер кластера ещё показывает строку (агент
  перечитывал до 4 раз с паузой 0,4 с). Список правдив на момент `readAt`; строка в таблице
  останется, и сообщать «сеанс снят» над ней нельзя — человек снимет ещё раз.
* **Где искать.** Сервис это состояние не применяет и не вырезает: оно в `data` ответа `POST`, а
  если команда ушла в ожидание (202) — в результате `GET /v1/onec/commands/:id`, который и так
  возвращает `awaitCommand`.

## Что сделать

### 1. Типы — `services/onec/api.ts`

```ts
/** Список кластера, приложенный агентом к ответу на снятие сеанса или соединения. */
export type ClusterListEcho = {
	items: ClusterRow[];
	complete: boolean;
	readAt?: string;
	/** Снятие прошло, но строка на момент readAt ещё в списке кластера. */
	stillListed?: boolean;
};

export type TerminateResult = { ok: boolean; state?: { sessions?: ClusterListEcho } };
export type DisconnectResult = { ok: boolean; state?: { connections?: ClusterListEcho } };
```

`terminateSession` → `awaitCommand<TerminateResult>(d)`, `disconnectConnection` →
`awaitCommand<DisconnectResult>(d)`.

### 2. Правило — функцией, чтобы его проверял тест

Например, `models/OneCAdmin/clusterEcho.ts`:

```ts
/**
 * СПИСОК ИЗ ОТВЕТА НА СНЯТИЕ — или null, и тогда перечитать, как раньше.
 *
 * Агент прикладывает к снятию список всего кластера, прочитанный сразу после снятия; им
 * замещается таблица без второй команды. null — старый агент или недочитанный кластер:
 * частичный список показал бы закрытыми сеансы, которые живы.
 */
export function echoList(
	result: { state?: Partial<Record<"sessions" | "connections", ClusterListEcho>> } | undefined,
	what: "sessions" | "connections",
): ClusterListEcho | null {
	const echo = result?.state?.[what];
	return echo && echo.complete === true && Array.isArray(echo.items) ? echo : null;
}
```

### 3. «Сеансы» — `SessionsTab.tsx`

* Импорт `useQueryClient` из `@tanstack/react-query` (сейчас его в файле нет), `const qc =
  useQueryClient();`.
* `terminate.onSuccess(r)`:

  ```ts
  const echo = echoList(r, "sessions");
  if (echo) qc.setQueryData(["onec", "sessions"], { items: echo.items });
  else void sessions.refetch();
  showToast(
  	translate(echo?.stillListed ? "onecSessionStillListed" : "onecSessionTerminated"),
  	echo?.stillListed ? "warning" : "success",
  );
  ```

* `terminateMany`: в цикле после каждого успешного снятия запоминать `lastEcho = echoList(r,
  "sessions")` и сразу класть его в `["onec","sessions"]` — строки будут пропадать по мере работы.
  **Решает ПОСЛЕДНЕЕ успешное снятие:** если у него эха нет, в `onSuccess` сделать `refetch` —
  список от более раннего снятия не знает о следующих. Сообщение об итоге — как сейчас.

### 4. «Соединения» — `ConnectionsTab.tsx`

То же для `disconnect`: `useQueryClient`, в цикле `lastEcho = echoList(r, "connections")` и
`qc.setQueryData(["onec", "connections"], { items: lastEcho.items })`; у последнего успешного
разрыва эха нет — `connections.refetch()`. Список блокировок (`["onec","locks"]`) в эхо не входит
и после разрыва по-прежнему не перечитывается — это не меняем.

### 5. Строки

| ключ | ru | kk |
|---|---|---|
| `onecSessionStillListed` | Сеанс завершается — он ещё виден в списке кластера. Обновите список через несколько секунд. | Сеанс аяқталуда — ол кластер тізімінде әлі көрінеді. Тізімді бірнеше секундтан кейін жаңартыңыз. |

(казахский текст — проверить носителем.)

### 6. Тест — `__tests__/onecClusterEcho.test.ts`

| вход | ожидание |
|---|---|
| `{ state: { sessions: { items: [row], complete: true } } }`, `"sessions"` | тот же объект |
| то же, но `complete: false` | `null` |
| `{ ok: true }` (старый агент) | `null` |
| `{ state: { sessions: { items: "x", complete: true } } }` | `null` |
| `{ state: { sessions: {…полный} } }`, `"connections"` | `null` |
| полный со `stillListed: true` | объект, `stillListed === true` |
| `{ state: { sessions: { items: [], complete: true } } }` | объект с пустым списком — снят последний сеанс, таблица должна опустеть |

## Не трогать

* Кнопку «Обновить» у таблиц — это чтение по просьбе человека.
* `staleTime: 0` у сеансов: `setQueryData` кладёт свежие данные, немедленного перезапроса он не
  вызывает.
* Сервис.

## Как проверить

1. Агент `0.1.0+2026-09-13 12:12 (+05)` или новее.
2. «Сеансы», снять один сеанс. В DevTools — один `POST /v1/onec/sessions/<uuid>/terminate` и ни
   одного `GET /v1/onec/sessions` следом; строка пропала из таблицы.
3. Отметить три сеанса → «Завершить сеансы»: три `POST`, без `GET`; строки пропадают по одной.
4. «Соединения» → разорвать: один `POST …/disconnect`, без `GET /v1/onec/connections`.
5. Агент старой сборки: после снятия, как прежде, `GET` списка.
