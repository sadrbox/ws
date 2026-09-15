/**
 * Что сервис записывает в реестр после изменяющей команды (TASK_SERVICE_ECHO_WRITE_COMMANDS.md).
 *
 * Сверка 14.09: блокировка сеансов, удаление регистрации, загрузка из выгрузки, обновление
 * конфигурации и снятие процесса отвечали «выполнено» и оставляли реестр прежним. Правило теста:
 * эхо агента — применяется; эха нет — записывается известное по факту, но реестр не молчит.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLock, planWriteState, readsAfter, readsAfterFailure } from "../src/onec/writeState.ts";
import { humanizeAgentError } from "../src/onec/errorHints.ts";
import { ibFailureReason } from "../src/bases/service.ts";

describe("состояние после изменяющей команды", () => {
	it("блокировка: эхо кластера — источник cluster", () => {
		const a = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true },
			{ ok: true, state: { lock: { enabled: true, message: "Обслуживание", from: null, to: null, readAt: "2026-09-14T10:00:00Z" } } });
		assert.deepEqual(a, [{ kind: "lock", source: "cluster",
			lock: { enabled: true, active: null, message: "Обслуживание", from: null, to: null, seenAt: "2026-09-14T10:00:00Z" } }]);
	});

	it("блокировка без эха — по команде; снятие стирает сообщение", () => {
		const on = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true, message: "до 19:00" }, { ok: true });
		assert.equal(on[0].kind === "lock" && on[0].source, "command");
		assert.equal(on[0].kind === "lock" && on[0].lock.message, "до 19:00");
		const off = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: false, message: "старое" }, { ok: true });
		assert.equal(off[0].kind === "lock" && off[0].lock.message, null);
	});

	it("код разрешения входа из эха не берётся никогда", () => {
		const a = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true },
			{ ok: true, state: { lock: { enabled: true, permissionCode: "секрет" } } });
		assert.ok(!JSON.stringify(a).includes("секрет"));
	});

	it("удаление регистрации: полный срез — применяем; без него — MISSING по факту", () => {
		const full = planWriteState("CLUSTER_DROP_INFOBASE", { baseKey: "aibek", confirm: true },
			{ ok: true, state: { infobases: { items: [{ key: "other" }], complete: true } } });
		assert.equal(full[0].kind, "infobases");
		const partial = planWriteState("CLUSTER_DROP_INFOBASE", { baseKey: "aibek" },
			{ ok: true, state: { infobases: { items: [{ key: "other" }], complete: false } } });
		assert.deepEqual(partial, [{ kind: "missing" }]);
		assert.deepEqual(planWriteState("CLUSTER_DROP_INFOBASE", { baseKey: "aibek" }, { ok: true }), [{ kind: "missing" }]);
	});

	it("обновление конфигурации: эхо — конфигурация; без эха — versionTo; dryRun — ничего", () => {
		const echo = planWriteState("IB_APPLY_UPDATE", { baseKey: "b", path: "x.cfu" },
			{ ok: true, versionTo: "3.0.46", state: { config: { name: "Бухгалтерия", version: "3.0.45.9", readAt: "t" } } });
		assert.deepEqual(echo, [{ kind: "config", config: { name: "Бухгалтерия", version: "3.0.45.9", seenAt: "t" } }]);
		assert.deepEqual(planWriteState("IB_APPLY_UPDATE", { baseKey: "b" }, { ok: true, versionTo: "3.0.46" }),
			[{ kind: "config", config: { name: null, version: "3.0.46", seenAt: null } }]);
		assert.deepEqual(planWriteState("IB_APPLY_UPDATE", { baseKey: "b", dryRun: true }, { ok: true, versionTo: "3.0.46" }), []);
	});

	it("процессы: из эха снятия и из живого чтения; кривая строка — не принимаем", () => {
		const kill = planWriteState("AGENT_KILL_PROCESS", { pid: 10 },
			{ ok: true, state: { processes: { items: [{ pid: 11, tool: "ibcmd", orphan: false }] } } });
		assert.deepEqual(kill, [{ kind: "processes", items: [{ pid: 11, tool: "ibcmd", orphan: false }] }]);
		assert.equal(planWriteState("AGENT_LIST_PROCESSES", {}, { items: [] })[0].kind, "processes");
		assert.deepEqual(planWriteState("AGENT_KILL_PROCESS", { pid: 10 },
			{ ok: true, state: { processes: { items: [{ pid: "x", tool: "rac" }] } } }), []);
		// Прерывание со снятием процесса (killed) — тот же список (T3).
		assert.equal(planWriteState("AGENT_CANCEL_COMMAND", { commandId: "cmd_1" },
			{ ok: true, killed: true, state: { processes: { items: [] } } })[0]?.kind, "processes");
	});

	it("публикация: только с эхом; снятие стирает адрес", () => {
		assert.deepEqual(planWriteState("IB_PUBLISH", { baseKey: "b" }, { ok: true, url: "http://x" }), []);
		assert.deepEqual(planWriteState("IB_UNPUBLISH", { baseKey: "b" },
			{ ok: true, state: { publication: { published: false, url: "http://old", readAt: "t" } } }),
		[{ kind: "publication", published: false, url: null, seenAt: "t" }]);
	});

	it("чтения после: загрузка — пользователи и расширения, минус принесённое эхом", () => {
		assert.deepEqual(readsAfter("IB_RESTORE", { baseKey: "b" }, { users: false, extensions: false }),
			["IB_LIST_USERS", "IB_LIST_EXTENSIONS"]);
		assert.deepEqual(readsAfter("IB_RESTORE", { baseKey: "b" }, { users: true, extensions: false }), ["IB_LIST_EXTENSIONS"]);
		assert.deepEqual(readsAfter("IB_RESTORE", { baseKey: "b", dryRun: true }, { users: false, extensions: false }), []);
		assert.deepEqual(readsAfter("IB_UPDATE_USER", { baseKey: "b" }, { users: true, extensions: false }), []);
		// Обновление конфигурации без эха: и расширения, и пользователи — роли могли пропасть (T4).
		assert.deepEqual(readsAfter("IB_APPLY_UPDATE", { baseKey: "b" }, { users: false, extensions: false }),
			["IB_LIST_USERS", "IB_LIST_EXTENSIONS"]);
		assert.deepEqual(readsAfter("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b" }, { users: false, extensions: false }), []);
	});
});

describe("S3: чтение после отказа «признак не принят»", () => {
	it("IB_FIELD_NOT_APPLIED у пользователя — перечитать пользователей, прочие отказы — нет", () => {
		assert.deepEqual(readsAfterFailure("IB_UPDATE_USER", "IB_FIELD_NOT_APPLIED"), ["IB_LIST_USERS"]);
		assert.deepEqual(readsAfterFailure("IB_CREATE_USER", "IB_FIELD_NOT_APPLIED"), ["IB_LIST_USERS"]);
		assert.deepEqual(readsAfterFailure("IB_UPDATE_USER", "IB_BUSY"), []);
		assert.deepEqual(readsAfterFailure("IB_RESTORE", "IB_FIELD_NOT_APPLIED"), []);
	});
});

describe("блокировка включена, но не действует (агент 23:16)", () => {
	it("`active` сохраняется как прочитано; нет поля — не знаем", () => {
		assert.equal(parseLock({ enabled: true, active: false, from: "2026-09-01T08:00:00", to: "2026-09-01T09:00:00" })?.active, false);
		assert.equal(parseLock({ enabled: true })?.active, null);
		const byCommand = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true }, { ok: true });
		assert.equal(byCommand[0].kind === "lock" && byCommand[0].lock.active, null);
	});

	it("SESSIONS_LOCK_NOT_ACTIVE — с подсказкой, что делать", () => {
		const e = humanizeAgentError({ code: "SESSIONS_LOCK_NOT_ACTIVE", message: "Блокировка не действует" });
		assert.match(e!.message, /Снимите блокировку/);
	});
});

describe("С15: обрыв связи с рабочим процессом кластера (агент 23:52)", () => {
	it("подсказка есть, а база не помечается недоступной даже при совпавших словах", () => {
		const error = {
			code: "IB_CONNECTION_LOST",
			message: "Тестирование начато… server_addr=tcp://SERVER:1560 descr=10054 forcibly closed. "
				+ "Процессы после начала: rphost 7692. Недостаточно прав у процесса? база данных отсутствует?",
		};
		assert.match(humanizeAgentError(error)!.message, /рабочим процессом кластера/);
		assert.equal(ibFailureReason(error), null);
	});
});

describe("С16: обрыв при незаданных пределах — процесс упал, пределы поднимать не нужно", () => {
	it("вывод агента есть — совет про журнал и дампы, без «поднимите пределы»", () => {
		const m = humanizeAgentError({
			code: "IB_CONNECTION_LOST",
			message: "Оборвалась связь… Пределы перезапуска и памяти не заданы — процесс, вероятнее всего, аварийно завершился.",
		})!.message;
		assert.match(m, /журнал «Приложение»/);
		assert.doesNotMatch(m, /поднимите пределы/);
	});
	it("вывода нет — прежний совет про пределы", () => {
		const m = humanizeAgentError({ code: "IB_CONNECTION_LOST", message: "tcp://SERVER:1560 10054" })!.message;
		assert.match(m, /поднимите пределы/);
	});
});
