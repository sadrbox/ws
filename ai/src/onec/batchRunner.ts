/**
 * ЗАПУСК ПАКЕТНОГО ЗАДАНИЯ — одним кодом для человека и для расписания.
 *
 * ЗАЧЕМ ВЫНЕСЕНО. Постановка задания жила внутри обработчика `POST /v1/onec/batch`: завести
 * задание, проверить вход на первой базе, выбрать агента под каждую базу, отсеять то, что
 * поставить нельзя, и запомнить отсеянное в самом задании. Расписание обслуживания (F2)
 * делает ровно это же — ночью и без человека, — и второй экземпляр той же логики разошёлся
 * бы с первым в первый же месяц: отсеянные базы, приоритет, срок жизни команды, пароль,
 * который нельзя писать в задание.
 *
 * ЧТО ЗДЕСЬ НЕ ДЕЛАЕТСЯ. Прав не проверяем и в журнал аудита не пишем: у запуска руками и у
 * запуска по расписанию разные субъекты (человек с правом `full` против самого сервиса), и
 * решать это должен вызывающий.
 */
import { DEFAULT_COMMAND_TTL_SECS, agentCanRun, baseRefusal, buildAdminPayload, findAdminCommand, payloadRefusal, runsInsideBase } from "../commands/admin.ts";

/**
 * Сколько команда группового задания может ждать очереди (С2). Сто баз при одном месте идут
 * часами, и задание, запущенное вечером, законно ждёт до утра — но не бесконечно.
 */
export const BATCH_QUEUE_WAIT_SECS = 12 * 3600;
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue } from "../commands/queue.ts";
import type { BatchService } from "./batches.ts";
import type { BaseService } from "../bases/service.ts";

/**
 * Что можно ставить ПАКЕТОМ по многим базам.
 *
 * Задание существует для ИЗМЕНЯЮЩИХ операций: их результат по каждой базе нужно хранить и к
 * нему возвращаться. Чтение (`IB_LIST_*`) идёт обычными запросами: нажал — увидел.
 */
export const BATCHABLE = new Set([
	"IB_CREATE_USER", "IB_UPDATE_USER", "IB_DELETE_USER", "IB_INSTALL_EXTENSION", "IB_DELETE_EXTENSION",
	// Публикация — первый шаг раскатки: опубликовать → поставить расширение → перейти
	// на HTTP. Делать это по одной базе из ста бессмысленно.
	"IB_PUBLISH", "IB_UNPUBLISH",
	// Выгрузка: по одной базе из ста её не делают, а результат по каждой нужен отдельно
	// (путь к файлу, ошибка занятой базы) — это ровно то, что даёт задание.
	"IB_BACKUP",
	// Проверка базы — та же история: по расписанию её гоняют по группе баз, и итог нужен
	// по каждой отдельно (см. расписание обслуживания, F2).
	"IB_CHECK",
	// «Операции» списка баз (17.09): сведения о базе и запрет регламентных заданий по отмеченным базам. Сведения —
	// вход в каждую базу, по сотне баз это десятки минут; запрет заданий ставят перед работами сразу группе баз.
	"IB_INFO", "CLUSTER_SET_SCHEDULED_JOBS",
	// Удалить регистрацию базы-фантома из кластера — «опасная команда» того же меню. По группе фантомов её делают
	// после «Проверить базы данных»; агент сам проверяет через СУБД, что базы данных нет, и у живой отказывает, а
	// `confirm: true` обязателен в теле задания так же, как в одиночной команде.
	"CLUSTER_DROP_INFOBASE",
]);

export type BatchStartResult = {
	batchId: string;
	total: number;
	queued: number;
	skipped: { baseKey: string; reason: string }[];
};

export type BatchStartInput = {
	type: string;
	baseKeys: string[];
	payload?: Record<string, unknown>;
	organizationUuid: string;
	/** Кто запустил; у расписания человека нет — `null`. */
	userUuid: string | null;
};

export type BatchDeps = {
	agents: AgentService; queue: CommandQueue; batches: BatchService;
	/** Состояние базы в реестре: скрытая и удалённая из кластера отсеиваются со своей причиной (С44). */
	bases: Pick<BaseService, "findByKeyGlobal">;
};

/** Почему запуск невозможен — текстом для человека (в HTTP уходит как VALIDATION_ERROR). */
export type BatchStartError = { error: string };

export const isBatchError = (r: BatchStartResult | BatchStartError): r is BatchStartError =>
	"error" in r;

/**
 * Поставить задание по списку баз.
 *
 * Вход проверяется ОДИН раз на первой базе: payload у всех команд одинаков, кроме ключа
 * базы, и сто одинаковых сообщений об одной ошибке никому не нужны.
 */
export async function startBatch(
	deps: BatchDeps, input: BatchStartInput,
): Promise<BatchStartResult | BatchStartError> {
	const type = input.type.toUpperCase();
	const keys = input.baseKeys.filter((k) => typeof k === "string" && !!k);

	if (!BATCHABLE.has(type)) return { error: `Пакетно выполняется только: ${[...BATCHABLE].join(", ")}` };
	if (!keys.length) return { error: "baseKeys: не выбрано ни одной базы" };

	const spec = findAdminCommand(type);
	if (!spec) return { error: `Неизвестная команда: ${type}` };

	const probe = buildAdminPayload(spec, { ...(input.payload ?? {}), baseKey: keys[0] });
	if (!probe.ok) return { error: probe.message };

	const batchId = await deps.batches.create({
		organizationUuid: input.organizationUuid,
		userUuid: input.userUuid,
		type,
		// Пароль и вложения в задание не пишем: оно живёт в БД и попадает в журнал.
		payload: Object.fromEntries(
			Object.entries(input.payload ?? {}).filter(([k]) => k !== "password" && k !== "contentBase64"),
		),
		total: keys.length,
	});

	let queued = 0;
	const skipped: { baseKey: string; reason: string }[] = [];
	for (const key of keys) {
		const built = buildAdminPayload(spec, { ...(input.payload ?? {}), baseKey: key });
		if (!built.ok) { skipped.push({ baseKey: key, reason: built.message }); continue; }
		// Скрытая база и база, которой нет в кластере, — с причиной, а не «нет агента на связи» (С44).
		const base = await deps.bases.findByKeyGlobal(key);
		const refused = base ? baseRefusal(spec, base) : null;
		if (refused) { skipped.push({ baseKey: key, reason: refused.message }); continue; }
		const agent = await deps.agents.pickAdminAgent(key);
		if (!agent || !agentCanRun(agent, spec)) {
			skipped.push({ baseKey: key, reason: agent ? `нет способности ${spec.capability}` : "нет агента на связи" });
			continue;
		}
		// Содержимое требует больше, чем тип (C5): база отсеивается с причиной, а не уходит
		// агенту, который ответит успехом и ничего не сделает.
		const refusal = payloadRefusal(agent, spec, built.payload);
		if (refusal) { skipped.push({ baseKey: key, reason: refusal }); continue; }
		const cmd = await deps.queue.enqueue({
			agentId: agent.id, organizationUuid: agent.organizationUuid, baseKey: key,
			type: spec.type, payload: built.payload, userUuid: input.userUuid,
			ttlSeconds: spec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS,
			queueWaitSeconds: BATCH_QUEUE_WAIT_SECS,
			inBase: runsInsideBase(spec),
			// Пачку по многим базам запускают и уходят: она не должна загораживать
			// одиночный запрос человека, который ждёт ответа на экране.
			priority: 10,
		});
		await deps.batches.attach(batchId, cmd.id);
		queued += 1;
	}

	// Отсеянные базы остаются В САМОМ ЗАДАНИИ: иначе оно показывает «в работе» там, где
	// работы нет вовсе — задание без строк, без базы и без команды.
	await deps.batches.noteSkipped(batchId, skipped);

	return { batchId, total: keys.length, queued, skipped };
}
