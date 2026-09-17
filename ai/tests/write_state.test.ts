/**
 * Что сервис записывает в реестр после изменяющей команды (TASK_SERVICE_ECHO_WRITE_COMMANDS.md).
 *
 * Сверка 14.09: блокировка сеансов, удаление регистрации, загрузка из выгрузки, обновление
 * конфигурации и снятие процесса отвечали «выполнено» и оставляли реестр прежним. Правило теста:
 * эхо агента — применяется; эха нет — записывается известное по факту, но реестр не молчит.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLock, parseProcesses, planWriteState, readsAfter, readsAfterFailure } from "../src/onec/writeState.ts";
import { humanizeAgentError } from "../src/onec/errorHints.ts";
import { ibFailureReason } from "../src/bases/service.ts";

describe("состояние после изменяющей команды", () => {
	it("блокировка: эхо кластера — источник cluster", () => {
		const a = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true },
			{ ok: true, state: { lock: { enabled: true, message: "Обслуживание", from: null, to: null, readAt: "2026-09-14T10:00:00Z" } } });
		assert.deepEqual(a, [{ kind: "lock", source: "cluster",
			lock: { enabled: true, active: null, permissionCodeSet: null, message: "Обслуживание", from: null, to: null,
				seenAt: "2026-09-14T10:00:00Z", scheduledJobsDenied: null } }]);
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
		assert.deepEqual(echo, [{ kind: "config", config: { name: "Бухгалтерия", version: "3.0.45.9", seenAt: "t" }, exact: true }]);
		assert.deepEqual(planWriteState("IB_APPLY_UPDATE", { baseKey: "b" }, { ok: true, versionTo: "3.0.46" }),
			[{ kind: "config", config: { name: null, version: "3.0.46", seenAt: null }, exact: false }]);
		assert.deepEqual(planWriteState("IB_APPLY_UPDATE", { baseKey: "b", dryRun: true }, { ok: true, versionTo: "3.0.46" }), []);
	});

	it("С35: IB_INFO — конфигурация как прочитана (версия не задана — null) и блокировка; расширения — не здесь", () => {
		const a = planWriteState("IB_INFO", { baseKey: "_transition" }, {
			ok: true, baseKey: "_transition",
			config: { name: "БухгалтерияПредприятия", version: null, synonym: "Бухгалтерия предприятия", readAt: "2026-09-15T18:24:00Z" },
			state: {
				config: { name: "БухгалтерияПредприятия", version: null, synonym: "Бухгалтерия предприятия", readAt: "2026-09-15T18:24:00Z" },
				lock: { enabled: false, readAt: "2026-09-15T18:24:00Z" },
			},
		});
		assert.deepEqual(a.map((x) => x.kind), ["lock", "config"]);
		assert.deepEqual(a[1], { kind: "config", exact: true,
			config: { name: "БухгалтерияПредприятия", version: null, seenAt: "2026-09-15T18:24:00Z" } });
		// Агент без кластера: `state.lock` нет, конфигурация — и из отдельного поля.
		assert.deepEqual(planWriteState("IB_INFO", { baseKey: "b" }, { ok: true, config: { name: "БП", version: "3.0.1", readAt: "t" } }),
			[{ kind: "config", exact: true, config: { name: "БП", version: "3.0.1", seenAt: "t" } }]);
		assert.deepEqual(planWriteState("IB_INFO", { baseKey: "b" }, { ok: true }), []);
	});

	it("С35: установка расширения — конфигурация базы из ответа; без неё — ничего", () => {
		assert.deepEqual(planWriteState("IB_INSTALL_EXTENSION", { baseKey: "b", name: "ext" },
			{ ok: true, config: { name: "БП", version: "3.0.180.20", readAt: "t" }, state: { extensions: { items: [], complete: true } } }),
		[{ kind: "config", exact: true, config: { name: "БП", version: "3.0.180.20", seenAt: "t" } }]);
		assert.deepEqual(planWriteState("IB_INSTALL_EXTENSION", { baseKey: "b", name: "ext" }, { ok: true }), []);
		assert.deepEqual(readsAfter("IB_INFO", { baseKey: "b" }, { users: false, extensions: false }), []);
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
		// Агент уже снял блокировку (С25): совет — включить заново, а не «снять».
		assert.match(e!.message, /Включите блокировку заново/);
	});
});

describe("С15: обрыв связи с рабочим процессом кластера (агент 23:52)", () => {
	it("подсказка есть, а база не помечается недоступной даже при совпавших словах", () => {
		const error = {
			code: "IB_CONNECTION_LOST",
			message: "Тестирование начато… server_addr=tcp://SERVER:1560 descr=10054 forcibly closed. "
				+ "Процессы после начала: rphost 7692. Недостаточно прав у процесса? база данных отсутствует?",
		};
		// С46: собеседника называет агент (по порту), подсказка его не назначает — но говорит, что связь оборвалась.
		assert.match(humanizeAgentError(error)!.message, /оборвалась связь со службой 1С/);
		assert.equal(ibFailureReason(error), null);
		// Процессы и пределы агент прикладывает НЕ всегда (живой случай 16.09) — подсказка обещает их условно.
		const bare = humanizeAgentError({ code: "IB_CONNECTION_LOST", message: "tcp://SERVER:1561 10054" })!.message;
		assert.doesNotMatch(bare, /Агент перечислил/);
		assert.match(bare, /Если агент привёл выше/);
	});
});

describe("С16: обрыв при незаданных пределах — процесс упал, пределы поднимать не нужно", () => {
	it("вывод агента есть — совет про журнал и дампы, без «поднимите пределы»", () => {
		const m = humanizeAgentError({
			code: "IB_CONNECTION_LOST",
			message: "Оборвалась связь… Пределы перезапуска и памяти не заданы — процесс, вероятнее всего, аварийно завершился.",
		})!.message;
		// С46: оба журнала Windows — перезапуски служб агент читает в «Системе».
		assert.match(m, /журналы Windows «Приложение»/);
		assert.match(m, /«Система»/);
		assert.doesNotMatch(m, /поднимите пределы/);
	});
	it("вывода нет — прежний совет про пределы", () => {
		const m = humanizeAgentError({ code: "IB_CONNECTION_LOST", message: "tcp://SERVER:1560 10054" })!.message;
		assert.match(m, /поднимите пределы/);
	});
});

describe("С26, С30: блокировка после загрузки и номер команды у процесса", () => {
	it("загрузка с эхом блокировки — блокировка и конфигурация в реестр; сухой прогон — ничего", () => {
		const result = { ok: true, state: {
			lock: { enabled: false, message: "", from: null, to: null, readAt: "2026-09-15T15:00:00Z" },
			config: { name: "БП", version: "3.0.45", readAt: "2026-09-15T15:00:00Z" },
		} };
		const a = planWriteState("IB_RESTORE", { baseKey: "b", path: "x.dt" }, result);
		assert.deepEqual(a.map((x) => x.kind), ["lock", "config"]);
		assert.equal(a[0].kind === "lock" && a[0].lock.enabled, false);
		assert.deepEqual(planWriteState("IB_RESTORE", { baseKey: "b", path: "x.dt", dryRun: true }, result), []);
		// Без эха блокировки (warning — снять не удалось) — только версия из ответа обновления.
		assert.deepEqual(planWriteState("IB_APPLY_UPDATE", { baseKey: "b", path: "u.cfu" }, { ok: true, versionTo: "3.0.46" })
			.map((x) => x.kind), ["config"]);
	});
	it("commandId процесса сохраняется", () => {
		assert.equal(parseProcesses([{ pid: 1234, tool: "1cv8", orphan: true, commandId: "cmd_1" }])?.[0].commandId, "cmd_1");
		assert.equal(parseProcesses([{ pid: 1, tool: "rac" }])?.[0].commandId, undefined);
	});
});

describe("С26, С31, С25: удаление регистрации, код разрешения, занятость агента", () => {
	it("stillListed у удаления регистрации — всё равно «нет в кластере»; признак кода разрешения хранится", () => {
		const items = [{ key: "a" }];
		assert.deepEqual(planWriteState("CLUSTER_DROP_INFOBASE", { baseKey: "b", confirm: true },
			{ ok: true, state: { infobases: { complete: true, items, stillListed: true } } }).map((x) => x.kind), ["infobases", "missing"]);
		assert.deepEqual(planWriteState("CLUSTER_DROP_INFOBASE", { baseKey: "b", confirm: true },
			{ ok: true, state: { infobases: { complete: true, items, stillListed: false } } }).map((x) => x.kind), ["infobases"]);
		assert.equal(parseLock({ enabled: true, permissionCodeSet: true })?.permissionCodeSet, true);
	});
	it("AGENT_BUSY: подсказка «не выполнялась — повторите», отметка «в базу не войти» не ставится", () => {
		const e = { code: "AGENT_BUSY", message: "Агент занят: команда ждала исполнителя 300 с и не выполнялась" };
		assert.match(humanizeAgentError(e)!.message, /не выполнялась — в базе ничего не изменено/);
		assert.equal(ibFailureReason(e), null);
		assert.equal(ibFailureReason({ code: "AGENT_STOPPING", message: "доступ запрещён" }), null);
	});
	it("IB_AUTH_FAILED — подсказка по коду, даже если текст на другом языке", () => {
		assert.match(humanizeAgentError({ code: "IB_AUTH_FAILED", message: "Authentication failed" })!.message, /Служебный администратор ИБ/);
	});
});

describe("С32: защитные отказы удаления регистрации", () => {
	it("подсказки по коду, причина «в базу не войти» не ставится, реестр не трогается", () => {
		const alive = { code: "INFOBASE_DB_ALIVE", message: "база данных отсутствует? нет — база работает" };
		assert.match(humanizeAgentError(alive)!.message, /удалять её регистрацию нельзя/);
		assert.equal(ibFailureReason(alive), null);
		for (const code of ["DB_PASSWORD_MISSING", "IBCMD_UNAVAILABLE", "DB_PARAMS_UNAVAILABLE", "DB_CHECK_FAILED"]) {
			assert.match(humanizeAgentError({ code, message: "отказ" })!.message, /Регистрация не удалена/, code);
		}
	});
});

describe("С39, С40: запрет регламентных и фоновых заданий — откуда известно", () => {
	it("признак в блокировке после записи — источник «кластер» со временем чтения", () => {
		const a = planWriteState("CLUSTER_SET_SCHEDULED_JOBS", { baseKey: "b", denied: true }, {
			ok: true, requested: true, denied: false, was: false,
			state: { lock: { enabled: false, message: "", from: null, to: null, readAt: "2026-09-16T07:00:00Z", scheduledJobsDenied: true } },
		});
		assert.equal(a[0].kind, "lock");
		// Блокировка важнее `denied`: она прочитана у кластера целиком.
		assert.deepEqual(a[1], { kind: "scheduledJobs", denied: true, source: "cluster", seenAt: "2026-09-16T07:00:00Z" });
	});

	it("блокировки нет, есть `denied` — это факт агента (с 23:45)", () => {
		const a = planWriteState("CLUSTER_SET_SCHEDULED_JOBS", { baseKey: "b", denied: true }, { ok: true, requested: true, denied: true });
		assert.deepEqual(a, [{ kind: "scheduledJobs", denied: true, source: "cluster", seenAt: null }]);
	});

	it("кластер промолчал — пишем то, что просили, с пометкой «по команде» и без времени чтения", () => {
		const a = planWriteState("CLUSTER_SET_SCHEDULED_JOBS", { baseKey: "b", denied: false }, { ok: true, unverified: ["denied"] });
		assert.deepEqual(a, [{ kind: "scheduledJobs", denied: false, source: "command", seenAt: null }]);
	});

	it("закрытие входа о заданиях не говорит: прежнее значение не трогается", () => {
		const a = planWriteState("CLUSTER_SET_SESSIONS_LOCK", { baseKey: "b", enabled: true }, { ok: true });
		assert.equal(a[0].kind === "lock" && a[0].lock.scheduledJobsDenied, null);
	});
});

describe("С41: оговорки успеха по типу команды", () => {
	it("запрет заданий: warning кластера и «не проверено»", async () => {
		const { commandCaveat } = await import("../src/onec/caveats.ts");
		const w = commandCaveat("CLUSTER_SET_SCHEDULED_JOBS", { ok: true, warning: "после записи регламентные задания по-прежнему разрешены" });
		assert.match(w ?? "", /по-прежнему разрешены/);
		assert.match(commandCaveat("CLUSTER_SET_SESSIONS_LOCK", { ok: true, unverified: ["enabled"] }) ?? "", /кластер не отдал состояние/);
		assert.equal(commandCaveat("CLUSTER_SET_SESSIONS_LOCK", { ok: true, enabled: true }), null);
	});

	it("установка расширения: другое имя и непринятые свойства", async () => {
		const { commandCaveat } = await import("../src/onec/caveats.ts");
		assert.match(commandCaveat("IB_INSTALL_EXTENSION", { ok: true, name: "Доработки_v2", requestedName: "Доработки" }) ?? "", /«Доработки_v2».*«Доработки»/);
		assert.equal(commandCaveat("IB_INSTALL_EXTENSION", { ok: true, name: "Доработки", requestedName: "Доработки" }), null);
		assert.match(commandCaveat("IB_INSTALL_EXTENSION", { ok: true, skipped: ["SafeMode"] }) ?? "", /SafeMode/);
	});

	it("запись пользователя — прежний разбор", async () => {
		const { commandCaveat } = await import("../src/onec/caveats.ts");
		assert.ok(commandCaveat("IB_UPDATE_USER", { ok: true, unverified: ["showInList"] }));
	});
});

describe("С42: держатель базы — поля агента в форме панели", () => {
	it("session/application/startedText → sessionId/appId/startedAt; ISO отдельно", async () => {
		const { normalizeLockedBy } = await import("../src/onec/errorHints.ts");
		assert.deepEqual(normalizeLockedBy({
			computer: "SERVER", session: 2, application: "Фоновое задание", user: "Регламент",
			startedAt: "2026-09-16T09:54:27", startedText: "16.09.2026 в 9:54:27",
		}), {
			computer: "SERVER", sessionId: "2", appId: "Фоновое задание", startedAt: "16.09.2026 в 9:54:27",
			user: "Регламент", startedAtIso: "2026-09-16T09:54:27",
		});
		assert.equal(normalizeLockedBy(null), null);
		assert.equal(normalizeLockedBy({}), null);
	});
});
