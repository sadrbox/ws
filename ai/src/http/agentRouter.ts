// Протокол Cloud ↔ Agent — серверная сторона. Контракт: bpapi_agent/README.md.
//
//   POST /agent/v1/register
//   POST /agent/v1/heartbeat
//   GET  /agent/v1/commands?wait=N        long-poll
//   POST /agent/v1/commands/:id/result
//
// Ответы — тот же конверт {success, data | error}, что и у buhprof_api: один формат на всю цепочку.

import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireAgent } from "../auth/index.ts";
import { decideInstance, instanceConflictMessage, isFarewell } from "../agents/instances.ts";
import { parseCommandStats } from "../agents/commandStats.ts";
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue } from "../commands/queue.ts";
import { DEFAULT_COMMAND_TTL_SECS, findAdminCommand, marksReachability } from "../commands/admin.ts";
import { BATCH_QUEUE_WAIT_SECS } from "../onec/batchRunner.ts";
import { BUSY_RETRY_DELAYS_SECS, RETRY_LATER_CODES, runningLeaseSecs } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import type { IbExtension, IbUser, OnecRegistry } from "../onec/registry.ts";
import { checkRoleIntent, checkShowInListIntent, parseEcho, roleVerdictMessage, showInListVerdictMessage } from "../onec/echo.ts";
import { listItems } from "../onec/listShape.ts";
import { rememberAfterEcho, writeBackOf } from "../onec/writeBack.ts";
import { parseLock, planWriteState, readsAfter, readsAfterFailure } from "../onec/writeState.ts";

/** Объект, а не массив и не скаляр: только у такого результата есть поле items. */
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
import {
	ibFailureReason, needsFullBases, publicationReport,
	type BaseService, type BaseState, type PublicationItem,
} from "../bases/service.ts";

// Состояние одной базы в register/heartbeat (E15/A2). Незаполненное поле значит «не знаю»:
// список баз и версию платформы даёт админ-агент, версию расширения — бизнес-агент, и
// затирать чужие данные своими пропусками нельзя.
const baseStateSchema = z.object({
	key: z.string().min(1).max(200),
	// UUID базы в кластере: им сеансы ссылаются на базу, без него отбор сеансов по базе
	// требовал бы отдельной команды агенту.
	id: z.string().max(64).optional(),
	// Публикация на веб-сервере: null/отсутствие — «не знаю», а не «нет».
	published: z.boolean().nullable().optional(),
	publishUrl: z.string().max(500).nullable().optional(),
	name: z.string().max(200).optional(),
	status: z.string().max(20).optional(),
	onecVersion: z.string().max(50).nullable().optional(),
	extVersion: z.string().max(50).nullable().optional(),
	sessionsCount: z.number().int().min(0).max(100000).optional(),
	// Есть ли у базы её данные в СУБД: ответ агента БЕЗ входа в базу (сборка 2026-09-12).
	// Трёхзначно, как и публикация: отсутствие поля — «не проверял», а не «всё хорошо».
	dbMissing: z.boolean().nullable().optional(),
	/** Блокировка сеансов в строке среза (E1); разбирает onec/writeState.parseLock. */
	lock: z.unknown().optional(),
});

const registerSchema = z.object({
	agentId: z.string().uuid(),
	agentName: z.string().max(200).optional().default(""),
	version: z.string().max(50),
	/** Идентификатор ПРОЦЕССА (pid + время старта): им ловится второй запущенный экземпляр. */
	instanceId: z.string().max(200).optional(),
	os: z.string().max(50).optional().default(""),
	capabilities: z.array(z.string().max(50)).max(100).optional().default([]),
	// v2: роль службы (business | admin), сервер 1С и список его баз.
	role: z.enum(["business", "admin"]).optional(),
	server: z.object({
		name: z.string().max(200).optional().default(""),
		rasHost: z.string().max(200).nullable().optional(),
		rasPort: z.number().int().min(1).max(65535).nullable().optional(),
	}).optional(),
	bases: z.array(baseStateSchema).max(500).optional(),
});

/** Список выполняемых команд из heartbeat (С33): до 100 строк, номер команды ≤ 64. */
const runningSchema = z.array(z.object({
	commandId: z.string().min(1).max(64),
	type: z.string().max(100).optional(),
	startedAt: z.string().max(40).optional(),
})).max(100);

const heartbeatSchema = z.object({
	agentId: z.string().uuid(),
	version: z.string().max(50).optional(),
	instanceId: z.string().max(200).optional(),
	status: z.string().max(20),
	onec: z.object({ reachable: z.boolean(), version: z.string().nullable().optional() }).optional(),
	commandsDone: z.number().int().optional(),
	commandsFailed: z.number().int().optional(),
	// v2: состояния баз. basesComplete=true — это полный срез, иначе только изменившиеся.
	bases: z.array(baseStateSchema).max(500).optional(),
	basesComplete: z.boolean().optional(),
	/**
	 * Процессы, которые агент запустил сам: rac, ibcmd, конфигуратор, webinst, мост.
	 * Приходят снимком в каждом heartbeat — это состояние, а не журнал. `orphan` значит
	 * «остался с прошлого запуска агента»: за таким уже никто не следит, и именно он
	 * обычно и есть «непонятная нагрузка на сервере».
	 */
	processes: z.array(z.object({
		pid: z.number().int(),
		tool: z.string().max(50),
		what: z.string().max(200).optional(),
		base: z.string().max(200).nullable().optional(),
		ageSecs: z.number().int().nonnegative().optional(),
		orphan: z.boolean().optional(),
		// Номер команды сервиса, запустившей процесс (агент 01:06, С30): по нему панель связывает долгую
		// операцию с её процессом, а очередь держит место базы после TIMEOUT (С18).
		commandId: z.string().max(64).optional(),
	})).max(200).optional(),
	/**
	 * Выполняемые команды (С33, агент 18:00, способность `agent.running`) — `unknown` НАМЕРЕННО: разбирает
	 * runningSchema в обработчике. Кривой список не должен превращать весь heartbeat в 400.
	 */
	running: z.unknown().optional(),
	/**
	 * Отказы по кодам и время команд (S5) — `unknown` НАМЕРЕННО: разбирает их
	 * agents/commandStats.ts. Строгая схема здесь превратила бы кривой снимок в 400 на весь
	 * heartbeat, и агент перестал бы считаться на связи из-за диагностики.
	 */
	failuresByCode: z.unknown().optional(),
	durationsByType: z.unknown().optional(),
});

const resultSchema = z.object({
	commandId: z.string().min(1).max(64),
	agentId: z.string().uuid(),
	status: z.enum(["SUCCESS", "ERROR"]),
	result: z.unknown().optional(),
	error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
	startedAt: z.string().optional(),
	finishedAt: z.string().optional(),
	onecHttpStatus: z.number().int().optional(),
});

/**
 * СКОЛЬКО БАЗ ПОЛНОГО СРЕЗА ПРИШЛО С СОСТОЯНИЕМ БЛОКИРОВКИ СЕАНСОВ (аудит 14.09, T1).
 *
 * Агент обещает поле `lock` в строках среза (E1, фоновое чтение), сервис его применяет, а в
 * реестре у 111 баз из 111 состояние пустое. Heartbeat не журналируется, и по данным не
 * различить «агент не прислал» и «сервис не записал». Число в журнале отвечает на это сразу.
 */
function logLockCoverage(log: Logger, agentId: string, rows: readonly unknown[]): void {
	const withLock = rows.filter((b) => !!parseLock((b as { lock?: unknown } | null)?.lock)).length;
	log.info({ agentId, bases: rows.length, withLock }, "полный срез баз: строк с блокировкой сеансов");
}
export function agentRouter(deps: { db: Db; cfg: Config; log: Logger; agents: AgentService; bases: BaseService; queue: CommandQueue; audit: Audit; registry: OnecRegistry }) {
	const { db, cfg, log, agents, bases, queue, audit, registry } = deps;
	const r = Router();
	r.use(requireAgent(db));
	// Любой запрос агента = он на связи. Запись лёгкая (одно UPDATE по первичному ключу),
	// а частота — раз в цикл опроса, то есть десятки секунд.
	/**
	 * Единственность экземпляра: под одним токеном работает ОДИН процесс.
	 *
	 * Второй получает 409 и не выполняет ни одной команды. Это защита от ошибки (забытая
	 * копия, токен, скопированный на вторую машину), а не аутентификация: идентификатор
	 * экземпляра агент называет сам. Кто не прислал заголовок — работает как раньше:
	 * ломать связь со старыми сборками из-за диагностики нельзя.
	 *
	 * Владение — АРЕНДА: молчащий дольше AGENT_OFFLINE_AFTER_SECS владелец уступает место
	 * сам. Без этого перезапуск службы (новый pid = новый идентификатор) закрывал бы агенту
	 * дорогу навсегда, а ручное «Сделать владельцем» пришлось бы повторять после каждого.
	 */
	r.use(async (req, res, next) => {
		void agents.touch(req.agent!.agentId);
		const instance = String(req.headers["x-agent-instance"] ?? "").trim().slice(0, 200);
		if (!instance) { next(); return; }

		const ver = String(req.headers["x-agent-version"] ?? "").trim() || null;
		// Адрес источника: два экземпляра на РАЗНЫХ машинах — это один токен, скопированный
		// с сервера 1С на машину разработки, и лечится он не так, как двойной запуск.
		void agents.touchInstance(req.agent!.agentId, instance, ver, req.ip ?? null);
		// Чистка попутно, без крона: строк единицы, а без неё за месяц копятся сотни
		// мёртвых записей о перезапусках.
		if (Math.random() < 0.01) void agents.pruneInstances();

		const own = await agents.owner(req.agent!.agentId);
		const decision = decideInstance({
			ownerInstanceId: own.instanceId,
			ownerSeenAt: own.seenAt,
			incomingInstanceId: instance,
			now: new Date(),
			offlineAfterSecs: cfg.AGENT_OFFLINE_AFTER_SECS,
		});

		if (decision.kind === "reject") {
			log.warn({ agentId: req.agent!.agentId, owner: decision.ownerInstanceId, incoming: instance },
				"второй экземпляр агента отклонён");
			res.status(409).json({ success: false, error: {
				code: "AGENT_INSTANCE_CONFLICT",
				message: instanceConflictMessage(decision.ownerInstanceId, decision.ownerSeenSecsAgo),
				/**
				 * ВЛАДЕЛЕЦ — ОТДЕЛЬНЫМ ПОЛЕМ, а не только в тексте.
				 *
				 * Агенту нужно отличить свой же перезапуск (та же машина и служба — подождать
				 * и повторить) от чужой копии токена (выключиться). Раньше он доставал
				 * идентификатор разбором фразы, и первая же правка формулировки заставила бы
				 * его выключаться при каждом обновлении службы — а чинить это было бы уже
				 * некому: он к тому моменту не подключится.
				 */
				details: {
					ownerInstanceId: decision.ownerInstanceId,
					ownerSeenSecsAgo: decision.ownerSeenSecsAgo,
				},
			} });
			return;
		}

		// Гонку двух стартующих процессов решает сам UPDATE с условием: у проигравшего
		// владельцем окажется чужой идентификатор, и он получит отказ на следующем запросе.
		const claimed = await agents.claimOwnership(req.agent!.agentId, instance, cfg.AGENT_OFFLINE_AFTER_SECS);
		if (!claimed) {
			const now = await agents.owner(req.agent!.agentId);
			res.status(409).json({ success: false, error: {
				code: "AGENT_INSTANCE_CONFLICT",
				message: instanceConflictMessage(now.instanceId ?? "неизвестный", 0),
			} });
			return;
		}
		if (decision.kind === "claim" && own.instanceId && own.instanceId !== instance) {
			await audit.write({ event: "agent.instance.takeover", agentId: req.agent!.agentId,
				details: { from: own.instanceId, to: instance } });
		}
		next();
	});

	// Агент вправе говорить только от своего имени: agentId в теле обязан совпадать с X-Agent-Id.
	const ownAgent = (bodyAgentId: string, req: { agent?: { agentId: string } }) =>
		bodyAgentId.toLowerCase() === req.agent?.agentId;

	/**
	 * Какой ПРОЦЕСС агента с нами говорит. Заголовок надёжнее тела: его шлют на каждом
	 * запросе, включая опрос команд, а `instanceId` есть только в register/heartbeat.
	 * Пусто — сборка старая и себя не называет; тогда всё работает по срокам, как раньше.
	 */
	const agentInstance = (req: { headers: Record<string, unknown>; body?: unknown }): string | null => {
		const head = String(req.headers["x-agent-instance"] ?? "").trim().slice(0, 200);
		if (head) return head;
		const fromBody = (req.body as { instanceId?: unknown } | undefined)?.instanceId;
		return typeof fromBody === "string" && fromBody.trim() ? fromBody.trim().slice(0, 200) : null;
	};

	r.post("/register", async (req, res) => {
		const p = registerSchema.safeParse(req.body);
		if (!p.success || !ownAgent(p.data.agentId, req)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректная регистрация" } });
			return;
		}
		// Сервер заводится по имени, которое прислал агент: со ста базами никто не будет
		// вносить серверы руками, а любой ручной список разойдётся с кластером за неделю.
		//
		// НО имя — не идентичность. Агент, уже закреплённый за сервером, при смене имени
		// (обновили сборку — прислал «SERVER» вместо «Сервер 1С») ДОЛЖЕН переименовать свой
		// сервер, а не заводить второй: иначе те же 110 баз появляются в реестре дважды,
		// и в панели каждая база двоится.
		const role = p.data.role ?? "business";
		const ras = { host: p.data.server?.rasHost ?? null, port: p.data.server?.rasPort ?? null };
		const known = await agents.findById(req.agent!.agentId);
		const server = known?.serverId
			? (await bases.renameServer(known.serverId, p.data.server?.name ?? "", ras))
				?? await bases.ensureServer(req.agent!.organizationUuid, p.data.server?.name ?? "", ras)
			: await bases.ensureServer(req.agent!.organizationUuid, p.data.server?.name ?? "", ras);
		await agents.register(req.agent!.agentId, {
			name: p.data.agentName, version: p.data.version, os: p.data.os, capabilities: p.data.capabilities,
			role, serverId: server.id,
		});
		/**
		 * НОВЫЙ ПРОЦЕСС — ЗНАЧИТ, ЗАБРАННОЕ ПРЕЖНИМ УЖЕ НЕ ВЕРНЁТСЯ.
		 *
		 * Обновили службу — и команда, забранная за секунду до остановки, висит `dispatched`
		 * до своего срока: в spool агента попадают готовые результаты, а прерванная работа не
		 * оставляет ничего. При `AGENT_IB_PARALLEL = 1` такая команда занимает единственное
		 * место, и все внутрибазовые операции стоят четверть часа (живой случай 12.09, 23:14).
		 *
		 * Закрываем только команды ЧУЖОГО экземпляра: агент регистрируется повторно и без
		 * перезапуска (перевыпуск токена, появившийся вход в базу), и трогать свои же идущие
		 * команды нельзя — выгрузка базы идёт часами.
		 */
		const lost = await queue.failLostByRestart(req.agent!.agentId, agentInstance(req) ?? "");
		if (lost.length) {
			log.warn({ agentId: req.agent!.agentId, count: lost.length, commands: lost },
				"агент перезапустился — команды прежнего процесса закрыты, очередь освобождена");
		}
		if (p.data.bases?.length) {
			await bases.sync(server.id, p.data.bases as BaseState[], { complete: true, authoritative: role === "admin" });
			await agents.markBasesSynced(req.agent!.agentId);
			logLockCoverage(log, req.agent!.agentId, p.data.bases);
		}
		/**
		 * Потеря способностей при обновлении агента — авария, которую иначе не заметить.
		 *
		 * Агент — источник истины о том, что он умеет, поэтому список просто перезаписывается.
		 * Но если новая сборка объявила МЕНЬШЕ прежней, панель начинает молча отказывать
		 * («агент не умеет ib.admin»), и связь с обновлением агента приходится угадывать.
		 * Записываем разницу поимённо: вопрос «что сломалось» тогда решается одним взглядом
		 * в журнал, а не сравнением сборок.
		 */
		{
			const before = (await agents.findById(req.agent!.agentId))?.capabilities ?? [];
			const after = new Set(p.data.capabilities);
			const lost = before.filter((c) => !after.has(c));
			if (lost.length) {
				log.warn({ agentId: req.agent!.agentId, version: p.data.version, lost },
					"агент объявил меньше способностей, чем прежде");
				await audit.write({
					event: "agent.capabilities.lost", agentId: req.agent!.agentId,
					details: { lost, before: before.length, after: p.data.capabilities.length, version: p.data.version },
				});
			}
		}
		if (p.data.instanceId) await agents.touchInstance(req.agent!.agentId, p.data.instanceId, p.data.version, req.ip ?? null);
		log.info({ agentId: req.agent!.agentId, version: p.data.version, role, bases: p.data.bases?.length ?? 0 }, "агент зарегистрирован");
		await audit.write({ event: "agent.register", agentId: req.agent!.agentId, organizationUuid: req.agent!.organizationUuid,
			details: { version: p.data.version, os: p.data.os, role, capabilities: p.data.capabilities.length, bases: p.data.bases?.length ?? 0 } });
		res.json({ success: true, data: {
			ok: true,
			pollMaxWaitSecs: cfg.POLL_MAX_WAIT_SECS,
			basesFullEverySecs: cfg.AGENT_BASES_FULL_EVERY_SECS,
			// Сервис продлевает срок выполняемых команд по `running` (С33): агент оставляет до срока запас
			// только до первого heartbeat, а не весь свой предел.
			runningLease: true,
		} });
	});

	r.post("/heartbeat", async (req, res) => {
		const p = heartbeatSchema.safeParse(req.body);
		if (!p.success || !ownAgent(p.data.agentId, req)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректный heartbeat" } });
			return;
		}
		if (p.data.instanceId) await agents.touchInstance(req.agent!.agentId, p.data.instanceId, p.data.version ?? null, req.ip ?? null);
		// Прошлый сигнал агента — до его обновления: по интервалу считается запас продления (С33).
		const prevSeenAt = p.data.running !== undefined ? (await agents.findById(req.agent!.agentId))?.lastSeenAt ?? null : null;
		await agents.heartbeat(req.agent!.agentId, {
			status: p.data.status,
			version: p.data.version,
			onecReachable: p.data.onec?.reachable ?? false,
			onecVersion: p.data.onec?.version ?? null,
		});
		/*
		 * УХОДЯЩИЙ ВЛАДЕЛЕЦ ГОВОРИТ «Я ВСЁ» (S1) — аренду до срока не держим, иначе заменивший
		 * его процесс получает 409 после каждого обновления службы. Промежуточный обработчик
		 * выше уже продлил владение на этом же запросе — снятие идёт после него. Команды здесь
		 * не закрываем: забранные агент возвращает сам, а оставшиеся за прежним процессом
		 * закрывает failLostByRestart при регистрации нового.
		 */
		const farewellInstance = agentInstance(req);
		if (farewellInstance && isFarewell(p.data.status)
			&& await agents.releaseOwnershipIf(req.agent!.agentId, farewellInstance)) {
			await audit.write({ event: "agent.instance.released", agentId: req.agent!.agentId,
				details: { instance: farewellInstance, reason: "farewell" } });
		}
		// Список процессов приходит попутно с heartbeat: отдельная команда нужна только
		// кнопке «Обновить сейчас», а раз в полминуты панель узнаёт о них бесплатно.
		if (p.data.processes) await agents.setProcesses(req.agent!.agentId, p.data.processes);
		// Выполняемые команды (С33): продлеваем их срок, пока агент подтверждает работу.
		if (p.data.running !== undefined) {
			const running = runningSchema.safeParse(p.data.running);
			if (!running.success) {
				log.warn({ agentId: req.agent!.agentId }, "список выполняемых команд в heartbeat не разобран — срок не продлевается");
			} else if (running.data.length) {
				await queue.extendRunning(req.agent!.agentId, running.data, runningLeaseSecs(prevSeenAt));
			}
		}
		// Отказы и время команд (S5) — тем же попутным снимком. Поля нет — прежний снимок не
		// затираем (старая сборка); не разобралось — пропускаем и называем, heartbeat принят.
		const commandStats = parseCommandStats(p.data);
		if (commandStats.rejected.length) {
			log.warn({ agentId: req.agent!.agentId, fields: commandStats.rejected },
				"статистика команд в heartbeat не разобрана — пропущена");
		}
		if (commandStats.stats) await agents.setCommandStats(req.agent!.agentId, commandStats.stats);

		const me = await agents.get(req.agent!.agentId);
		if (p.data.bases?.length && me?.serverId) {
			await bases.sync(me.serverId, p.data.bases as BaseState[],
				{ complete: p.data.basesComplete === true, authoritative: me.role === "admin" });
			if (p.data.basesComplete) {
				await agents.markBasesSynced(req.agent!.agentId);
				logLockCoverage(log, req.agent!.agentId, p.data.bases);
			}
		}
		// Сервер сам решает, когда ему нужен полный срез: агенту остаётся только слушаться.
		// Так интервал меняется в конфигурации сервиса, а не переустановкой службы на сервере 1С,
		// и после перезапуска сервиса полный список запрашивается сразу.
		const wantFullBases = !!me?.serverId
			&& needsFullBases(p.data.basesComplete ? new Date() : me.basesSyncedAt, cfg.AGENT_BASES_FULL_EVERY_SECS);
		res.json({ success: true, data: {
			ok: true,
			wantFullBases,
			basesFullEverySecs: cfg.AGENT_BASES_FULL_EVERY_SECS,
		} });
	});

	r.get("/commands", async (req, res) => {
		const wanted = Number.parseInt(String(req.query.wait ?? "20"), 10);
		const wait = Math.min(Number.isFinite(wanted) && wanted > 0 ? wanted : 20, cfg.POLL_MAX_WAIT_SECS);
		// Клиент мог отключиться, пока мы ждём: тогда команды НЕ выдаём — иначе они повиснут в
		// dispatched у агента, который их не получил.
		let closed = false;
		req.on("close", () => { closed = true; });
		// Пока опрос открыт, агент точно жив; закрылся и не переоткрылся — служба
		// остановлена, и панель узнаёт об этом за секунды, а не через полторы минуты
		// молчания heartbeat.
		agents.notePollOpen(req.agent!.agentId);
		let handedBusyMs = 0;
		try {
			const commands = await queue.take(req.agent!.agentId, wait, agentInstance(req));
			if (closed && commands.length) {
				await db.query(`UPDATE commands SET state = 'queued', dispatched_at = NULL WHERE id = ANY($1) AND state = 'dispatched'`,
					[commands.map((c) => c.id)]);
				return;
			}
			if (commands.length) log.info({ agentId: req.agent!.agentId, count: commands.length }, "команды выданы агенту");
			// Сколько агент вправе молчать после этого опроса: он ушёл выполнять то, что
			// забрал, и срок ему отведён самой командой. Без команд — ноль: работающий
			// агент переоткрывает опрос немедленно, и пауза означает остановку службы.
			handedBusyMs = commands.reduce((max, c) => {
				const ttl = findAdminCommand(c.type)?.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS;
				return Math.max(max, ttl * 1000);
			}, 0);
			res.json({ commands });
		} finally {
			agents.notePollClosed(req.agent!.agentId, handedBusyMs ? Date.now() + handedBusyMs : 0);
		}
	});

	r.post("/commands/:id/result", async (req, res) => {
		const p = resultSchema.safeParse({ ...req.body, commandId: req.params.id });
		if (!p.success || !ownAgent(p.data.agentId, req)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректный результат" } });
			return;
		}
		/**
		 * ЭХО СОСТОЯНИЯ — разбираем ДО записи результата.
		 *
		 * Агент со способностью `ib.echo` прикладывает к изменяющей команде новое содержимое
		 * базы, прочитанное тем же открытым соединением. Применённое в командную запись не
		 * ложится (см. onec/echo.ts): в реестре оно уже есть, а задание на сто баз положило бы
		 * в журнал сто списков.
		 */
		/**
		 * ФОРМУ СПИСКА ПОПРАВЛЯЕМ НА ВХОДЕ, А НЕ В КАЖДОМ ЧИТАТЕЛЕ.
		 *
		 * Сборка агента начала отвечать вложенным списком — `{"items": [[{…}, {…}]]}` вместо
		 * `{"items": [{…}, {…}]}` (12.09, 21:38 местного). Разворачиваем здесь, у самой
		 * границы: дальше результат ложится в командную запись, из неё же его читает панель
		 * при опросе и вкладки карточки — иначе лишнюю пару скобок пришлось бы помнить в
		 * пяти местах, а забыть — в одном. Подробности и цена ошибки — в onec/listShape.ts.
		 */
		const shape = p.data.status === "SUCCESS" ? listItems(p.data.result) : null;
		if (shape?.unwrapped && isRecord(p.data.result)) {
			log.warn({
				commandId: p.data.commandId, items: shape.items.length,
			}, "список в ответе агента пришёл вложенным (items: [[…]]) — развернули; сборке агента нужна правка");
			p.data.result = { ...p.data.result, items: shape.items };
		}

		const echo = p.data.status === "SUCCESS" ? parseEcho(p.data.result) : null;

		/**
		 * КОМАНДА, НЕ СДЕЛАВШАЯ СКАЗАННОГО, НЕ ОТЧИТЫВАЕТСЯ УСПЕХОМ.
		 *
		 * Живой случай 12.09: `IB_UPDATE_USER` с `addRoles` возвращала `{"ok": true}`, а в
		 * приложенном к ней же списке пользователей роли оставались прежними — сборка агента
		 * эти поля не применяет. Панель показывала «Выполнено», и человек уходил, считая
		 * права выданными. Эхо позволяет сличить намерение с результатом сразу же (см.
		 * onec/echo.ts), и если роли не изменились — это отказ, а не успех.
		 *
		 * Состояние базы из эха при этом ВСЁ РАВНО применяется ниже: оно правдиво, каким бы
		 * ни был приговор команде.
		 */
		let wire = echo ? { ...p.data, result: echo.result } : p.data;
		// Запись команды читаем ДО её завершения: из неё известно, что именно приказали —
		// это нужно и для сверки ролей ниже, и для запоминания непрочитываемых реквизитов.
		const pending = p.data.status === "SUCCESS" ? await queue.get(p.data.commandId) : null;
		if (echo?.state.users) {
			const verdict = pending ? checkRoleIntent(pending.payload, echo.state.users) : { ok: true as const };
			if (!verdict.ok) {
				const message = roleVerdictMessage(verdict);
				wire = {
					...wire,
					status: "ERROR",
					error: { code: "AGENT_ROLES_NOT_APPLIED", message, details: verdict },
				};
				log.warn({
					commandId: p.data.commandId, type: pending?.type, baseKey: pending?.base_key,
					notAdded: verdict.notAdded, notRemoved: verdict.notRemoved,
				}, "агент доложил об успехе, но роли не изменились");
			}
		}
		/**
		 * ЗАПОМИНАЕМ ТО, ЧЕГО НЕ ПРОЧИТАТЬ, — по факту своей же успешной записи, и ДО того,
		 * как команда станет «выполнена».
		 *
		 * «Показывать в списке выбора» 1С в списке пользователей не отдаёт. Пока записанное
		 * никто не запоминал, выходило так: человек включает тумблер, команда выполняется
		 * успешно, панель перечитывает базу — и показывает «выключено», потому что значения
		 * не знает. Со стороны это и есть «не записывается» (жалоба 12.09, дважды за вечер).
		 *
		 * Порядок важен: панель узнаёт о завершении по состоянию команды и сразу перечитывает
		 * реестр — значение обязано быть там уже к этому моменту.
		 */
		// Признак из эха не равен записанному — отказ, как у ролей (S1).
		if (echo?.state.users && pending && wire.status === "SUCCESS") {
			const shown = checkShowInListIntent(pending.payload, echo.state.users);
			if (!shown.ok) {
				wire = {
					...wire,
					status: "ERROR",
					error: { code: "AGENT_FIELD_NOT_APPLIED", message: showInListVerdictMessage(shown), details: shown },
				};
				log.warn({
					commandId: p.data.commandId, type: pending.type, baseKey: pending.base_key,
					name: shown.name, wanted: shown.wanted, actual: shown.actual,
				}, "агент доложил об успехе, но «показывать в списке выбора» в базе другое");
			}
		}
		const remember = pending?.base_key && wire.status === "SUCCESS" ? writeBackOf(pending.type, pending.payload) : null;
		const rememberShow = async (baseId: string) => {
			if (!remember) return;
			const saved = await registry.rememberShowInList(baseId, remember.name, remember.showInList);
			if (!saved) {
				log.warn({
					commandId: p.data.commandId, baseKey: pending?.base_key, name: remember.name,
				}, "признак «показывать в списке» запомнить не удалось: пользователя нет в реестре");
			}
		};
		// Без эха пользователей (старая сборка) — сразу, до «выполнено». С эхом — ниже, ПОСЛЕ
		// его применения (S2): строка пользователя уже есть, а прочитанное у 1С важнее памяти.
		if (remember && pending?.base_key && !echo?.state.users) {
			const base = await bases.findByKeyGlobal(pending.base_key);
			if (base) await rememberShow(base.id);
		}

		const row = await queue.complete(req.agent!.agentId, wire);
		if (!row) {
			// Результат не принят. Отвечаем 200 в любом случае, иначе агент будет вечно досылать
			// его из spool. Но в журнале причины различаем (S2): «отменённая команда» — это
			// итог отмены, который поздний результат перетёр бы, а «неизвестная» — повод
			// разбираться (очищена по сроку или чужая).
			const known = pending ?? await queue.get(p.data.commandId);
			log.warn({ agentId: req.agent!.agentId, commandId: p.data.commandId, type: known?.type },
				known?.state === "canceled"
					? "результат по отменённой команде отброшен"
					: "результат для неизвестной команды");
			res.json({ success: true, data: { ok: true, ignored: true } });
			return;
		}
		// База занята — команде задания даётся ещё попытка в конце очереди (С10): агент сам советует
		// повторить такие базы, а ночное обслуживание иначе пропускало базу из-за одного входа.
		// То же — «агент занят» и «служба останавливалась до начала» (С31, С25): команда не выполнялась.
		if (wire.status === "ERROR" && RETRY_LATER_CODES.has(wire.error?.code ?? "") && row.batch_id) {
			const again = await queue.retryBusy(row.id, BATCH_QUEUE_WAIT_SECS);
			if (again) {
				const attempt = (row.attempt ?? 1) + 1;
				log.info({
					commandId: row.id, retry: again, baseKey: row.base_key, attempt,
					delaySecs: BUSY_RETRY_DELAYS_SECS[Math.min(attempt, 3) - 2],
					code: wire.error?.code,
				}, "база или агент заняты — команда задания поставлена повторно с паузой");
			}
		}
		if (row.late) {
			// Пришёл после истечения срока (С21): принят и отмечен — итог правдив, но опоздал.
			log.warn({ commandId: row.id, type: row.type, baseKey: row.base_key, status: wire.status },
				"результат команды пришёл после истечения её срока — принят и отмечен поздним");
		}
		// Полный срез баз применяем к реестру ЗДЕСЬ же. Панель могла не дождаться ответа
		// (запрос ограничен 20 с, а rac по сотне баз бывает дольше) — тогда синхронизация
		// в её обработчике не выполнится, и «Обновить из кластера» тихо ничего не сделает.
		if (p.data.status === "SUCCESS" && row.type === "CLUSTER_LIST_INFOBASES") {
			const items = (p.data.result as { items?: BaseState[] } | null)?.items;
			const me = await agents.findById(req.agent!.agentId);
			if (Array.isArray(items) && items.length && me?.serverId) {
				await bases.sync(me.serverId, items, { complete: true, authoritative: me.role === "admin" });
			}
		}
		// Проверка наличия баз данных (S3) — здесь же и по той же причине: на сотне баз она
		// дольше, чем панель ждёт ответа, и обработчик HTTP-запроса результата не увидит.
		if (p.data.status === "SUCCESS" && row.type === "CLUSTER_CHECK_BASES") {
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId) await bases.applyCheckResult(me.serverId, p.data.result);
		}
		// Прерывание начатой команды (S4): агент снял задачу и результата по ней не пришлёт —
		// закрываем её сами, иначе она держит место до срока. Здесь, а не только в обработчике
		// панели: ответ на отмену мог прийти позже, чем панель ждала (202).
		if (p.data.status === "SUCCESS" && row.type === "AGENT_CANCEL_COMMAND") {
			const answer = p.data.result as { ok?: boolean; note?: string } | null;
			const aborted = typeof row.payload?.commandId === "string" ? row.payload.commandId : null;
			if (answer?.ok === true && aborted) await queue.abort(aborted, row.user_uuid, answer.note ?? null);
		}
		// Экземпляр из details ошибки БОЛЬШЕ НЕ ЗАВОДИМ. Это была замена ещё не
		// реализованного X-Agent-Instance; теперь агент шлёт заголовок, а «host#pid»
		// заводил ВТОРУЮ запись для того же процесса — и список экземпляров показывал
		// один процесс дважды, под разными именами. Машина и процесс из details
		// по-прежнему видны в тексте ошибки (describeResponder).
		/*
		 * СОСТОЯНИЕ ПОСЛЕ ИЗМЕНЕНИЯ (TASK_SERVICE_ECHO_WRITE_COMMANDS.md, S1–S5): блокировка,
		 * удалённая регистрация, конфигурация, процессы, публикация. Что записать — решает
		 * onec/writeState.planWriteState: эхо агента, а без него — известное по факту команды.
		 */
		const writeState = p.data.status === "SUCCESS"
			? planWriteState(row.type, (row.payload ?? {}) as Record<string, unknown>, p.data.result)
			: [];
		if (writeState.length) {
			const me = await agents.findById(req.agent!.agentId);
			for (const a of writeState) {
				if (a.kind === "processes") { await agents.setProcesses(row.agent_id, a.items); continue; }
				if (!me?.serverId) continue;
				if (a.kind === "infobases") {
					await bases.sync(me.serverId, a.items as unknown as BaseState[], { complete: true, authoritative: me.role === "admin" });
					continue;
				}
				if (!row.base_key) continue;
				if (a.kind === "lock") await bases.setSessionsLock(me.serverId, row.base_key, a.lock, a.source);
				else if (a.kind === "missing") await bases.markMissing(me.serverId, row.base_key);
				else if (a.kind === "config") await bases.setConfig(me.serverId, row.base_key, a.config);
				else if (a.kind === "publication") {
					await bases.setPublication(me.serverId, row.base_key, a.published, a.url, a.seenAt);
				}
			}
			log.info({ commandId: row.id, type: row.type, baseKey: row.base_key, applied: writeState.map((a) => a.kind) },
				"состояние после изменения применено к реестру");
		}
		// Публикация и её снятие — сразу в реестр: иначе состояние обновилось бы только
		// ближайшим полным срезом, а пользователь ждёт результата здесь и сейчас.
		if (p.data.status === "SUCCESS" && row.base_key
			&& (row.type === "IB_PUBLISH" || row.type === "IB_UNPUBLISH")
			// Эхо публикации (E6) уже записано выше — по факту команды записываем только без него.
			&& !writeState.some((a) => a.kind === "publication")) {
			const published = row.type === "IB_PUBLISH";
			const url = published ? (p.data.result as { url?: string } | null)?.url ?? null : null;
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId) await bases.setPublication(me.serverId, row.base_key, published, url);
		}
		// Срез публикаций может прийти и не из ручки панели (пакет, повтор задания) —
		// применяем его на общем пути приёма результатов.
		if (p.data.status === "SUCCESS" && row.type === "CLUSTER_LIST_PUBLICATIONS") {
			const data = p.data.result as {
				items?: PublicationItem[]; complete?: boolean; source?: string; lookedIn?: string[];
			} | null;
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId && Array.isArray(data?.items) && data.items.length) {
				const evidence = { source: data.source ?? null, lookedIn: data.lookedIn?.length ?? 0 };
				const report = publicationReport(data.items, data.complete === true, evidence);
				const r = await bases.applyPublications(me.serverId, data.items, data.complete === true, evidence);
				// Ответ, из которого не узнана ни одна база, — не «ничего не опубликовано», а
				// разговор на разных языках. Молча проглатывать такое нельзя: реестр
				// останется с прежним, а в логе будет видно, с чем разбираться.
				if (!r.matched || !report.accepted) {
					log.warn({
						agentId: req.agent!.agentId, items: report.total, matched: r.matched,
						published: report.published, complete: report.complete,
						source: evidence.source, lookedIn: evidence.lookedIn,
						sample: data.items[0]?.key,
					}, !report.accepted
						? "в срезе публикаций нет ни одной опубликованной базы — принимаем это за незнание, а не за факт"
						: "срез публикаций не сопоставлен ни с одной базой — реестр не тронут");
				}
			}
		}
		/**
		 * После УДАЧНОГО изменения содержимого базы сразу ставим чтение того же содержимого.
		 *
		 * Иначе реестр остаётся с данными «до»: панель показывает прежние роли и прежний
		 * список расширений, пока кто-нибудь не нажмёт «Проверить». Человек, только что
		 * назначивший роль, видит, что её нет, — и жмёт назначить ещё раз.
		 *
		 * `requestId` делает это идемпотентным: если чтение по этой базе уже стоит в
		 * очереди, второе не создаётся (частичный уникальный индекс среди незавершённых).
		 */
		/**
		 * Состояние из ответа кладём в реестр СРАЗУ: он становится актуальным в тот же миг,
		 * когда команда стала `done`. Панель читает содержимое базы из реестра
		 * (`/bases/:key/users/cached`), поэтому больше ей ждать нечего и спрашивать нечего.
		 */
		const applied = { users: false, extensions: false };
		if (echo && row.base_key) {
			const base = await bases.findByKeyGlobal(row.base_key);
			// Базы нет в реестре — применять некуда; тогда ниже отработает обычное чтение.
			if (base) {
				if (echo.state.users) {
					await registry.syncUsers(base.id, echo.state.users);
					applied.users = true;
					if (remember && rememberAfterEcho(remember, echo.state.users)) await rememberShow(base.id);
				}
				if (echo.state.extensions) {
					await registry.syncExtensions(base.id, echo.state.extensions);
					applied.extensions = true;
				}
				log.info({
					commandId: row.id, type: row.type, baseKey: row.base_key,
					users: echo.state.users?.length ?? null, extensions: echo.state.extensions?.length ?? null,
				}, "состояние базы применено из ответа команды — читающая команда не нужна");
			}
		}
		// Что эхо не принесло — читаем (onec/writeState.readsAfter): загрузка из выгрузки меняет и
		// пользователей, и расширения; второй вход в базу за тем, что уже пришло, не нужен.
		// После отказа «признак не принят» остальное уже записано — тоже читаем (S3).
		const reads = !row.base_key ? []
			: p.data.status === "SUCCESS"
				? readsAfter(row.type, (row.payload ?? {}) as Record<string, unknown>, applied)
				: readsAfterFailure(row.type, p.data.error?.code);
		for (const refreshType of reads) {
			await queue.enqueue({
				agentId: req.agent!.agentId,
				organizationUuid: row.organization_uuid,
				baseKey: row.base_key!,
				inBase: true,
				type: refreshType,
				payload: { baseKey: row.base_key },
				requestId: `refresh:${refreshType}:${row.base_key}`,
				ttlSeconds: 900,
			});
		}
		/*
		 * ВОЙТИ В БАЗУ НЕ УДАЛОСЬ — ОТДЕЛЬНЫЙ ФАКТ, И ОН НЕ ДОЛЖЕН ТЕРЯТЬСЯ.
		 *
		 * Раньше такую базу помечали `status = MISSING`, а вернуть её в ONLINE должен был
		 * «ближайший успешный срез кластера». На деле срез возвращал ONLINE ВСЕГДА: `rac`
		 * перечисляет регистрацию в кластере, и для базы, снесённой на СУБД, запись есть.
		 * Знание, добытое входом, затиралось источником, который входить не умеет, — и по
		 * кругу: база выглядит рабочей, человек жмёт «Обновить», ждёт, получает «база не
		 * найдена на сервере», через минуту всё повторяется.
		 *
		 * Теперь признак ставит и снимает ТОЛЬКО тот, кто в базу заходит.
		 */
		/*
		 * ПРИЧИНУ РАЗБИРАЕМ ПО ТЕКСТУ, А НЕ ТОЛЬКО ПО КОДУ. Код у агента крупный — IB_ERROR
		 * на всё, что ответила утилита, — и по нему база `aibek` («База данных отсутствует
		 * в сервере баз данных») ничем не отличалась от занятого каталога: отметка не
		 * ставилась, база оставалась «рабочей», и её снова и снова звали командами.
		 * Классификация намеренно узкая: не узнали причину — ничего не помечаем.
		 */
		const failReason = p.data.status === "SUCCESS" ? null : ibFailureReason(p.data.error);
		if (row.base_key && (p.data.status === "SUCCESS" || failReason)) {
			const spec = findAdminCommand(row.type);
			// Только команды ВНУТРЬ базы: срез кластера об этом ничего не знает.
			// И не по сухому прогону (С5): он в базу не входил, его успех ничего не доказывает.
			if (spec && marksReachability(spec, (row.payload ?? {}) as Record<string, unknown>)) {
				const me = await agents.findById(req.agent!.agentId);
				if (me?.serverId) {
					await bases.markIbReachable(
						me.serverId, row.base_key, p.data.status === "SUCCESS", failReason ?? "UNKNOWN",
					);
				}
			}
		}
		// Списки содержимого базы оседают в кэше здесь, а не в HTTP-ручке панели: тем же
		// путём приходят результаты ПАКЕТНОЙ проверки, которую никто не ждёт в запросе.
		if (p.data.status === "SUCCESS" && row.base_key && (row.type === "IB_LIST_USERS" || row.type === "IB_LIST_EXTENSIONS")) {
			/*
			 * НЕУЗНАННУЮ ФОРМУ НЕ СЧИТАЕМ ПУСТЫМ СРЕЗОМ. Прежний код видел непустой массив,
			 * не находил в нём ни одной записи и удалял из кэша ВСЕХ: полный срез,
			 * разобранный неправильно, выглядит как «пользователей больше нет». Именно так
			 * 12.09 опустели `_transition` и `abdali` (см. onec/listShape.ts).
			 */
			const list = listItems(p.data.result);
			if (!list) {
				log.warn({
					commandId: row.id, type: row.type, baseKey: row.base_key,
				}, "список в ответе агента неузнанной формы — кэш базы не трогаем");
			} else {
				const base = await bases.findByKeyGlobal(row.base_key);
				if (base) {
					if (row.type === "IB_LIST_USERS") await registry.syncUsers(base.id, list.items as IbUser[]);
					else await registry.syncExtensions(base.id, list.items as IbExtension[]);
				}
			}
		}
		log.info({ commandId: row.id, status: p.data.status, code: p.data.error?.code }, "результат команды");
		await audit.write({ event: "command.result", agentId: row.agent_id, organizationUuid: row.organization_uuid,
			userUuid: row.user_uuid, conversationId: row.conversation_id, commandId: row.id, requestId: row.request_id,
			details: { type: row.type, status: p.data.status, code: p.data.error?.code ?? null, onecHttpStatus: p.data.onecHttpStatus ?? null } });
		res.json({ success: true, data: { ok: true } });
	});

	return r;
}
