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
import { decideInstance, instanceConflictMessage } from "../agents/instances.ts";
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import type { IbExtension, IbUser, OnecRegistry } from "../onec/registry.ts";
import { type BaseService, type BaseState, needsFullBases } from "../bases/service.ts";

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
	})).max(200).optional(),
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
		if (p.data.bases?.length) {
			await bases.sync(server.id, p.data.bases as BaseState[], { complete: true, authoritative: role === "admin" });
			await agents.markBasesSynced(req.agent!.agentId);
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
		} });
	});

	r.post("/heartbeat", async (req, res) => {
		const p = heartbeatSchema.safeParse(req.body);
		if (!p.success || !ownAgent(p.data.agentId, req)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректный heartbeat" } });
			return;
		}
		if (p.data.instanceId) await agents.touchInstance(req.agent!.agentId, p.data.instanceId, p.data.version ?? null, req.ip ?? null);
		await agents.heartbeat(req.agent!.agentId, {
			status: p.data.status,
			version: p.data.version,
			onecReachable: p.data.onec?.reachable ?? false,
			onecVersion: p.data.onec?.version ?? null,
		});
		// Список процессов приходит попутно с heartbeat: отдельная команда нужна только
		// кнопке «Обновить сейчас», а раз в полминуты панель узнаёт о них бесплатно.
		if (p.data.processes) await agents.setProcesses(req.agent!.agentId, p.data.processes);

		const me = await agents.get(req.agent!.agentId);
		if (p.data.bases?.length && me?.serverId) {
			await bases.sync(me.serverId, p.data.bases as BaseState[],
				{ complete: p.data.basesComplete === true, authoritative: me.role === "admin" });
			if (p.data.basesComplete) await agents.markBasesSynced(req.agent!.agentId);
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
		try {
			const commands = await queue.take(req.agent!.agentId, wait);
			if (closed && commands.length) {
				await db.query(`UPDATE commands SET state = 'queued', dispatched_at = NULL WHERE id = ANY($1) AND state = 'dispatched'`,
					[commands.map((c) => c.id)]);
				return;
			}
			if (commands.length) log.info({ agentId: req.agent!.agentId, count: commands.length }, "команды выданы агенту");
			res.json({ commands });
		} finally {
			agents.notePollClosed(req.agent!.agentId);
		}
	});

	r.post("/commands/:id/result", async (req, res) => {
		const p = resultSchema.safeParse({ ...req.body, commandId: req.params.id });
		if (!p.success || !ownAgent(p.data.agentId, req)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректный результат" } });
			return;
		}
		const row = await queue.complete(req.agent!.agentId, p.data);
		if (!row) {
			// Неизвестная команда: возможно, очищена по сроку. Отвечаем 200, иначе агент будет
			// вечно досылать её из spool.
			log.warn({ agentId: req.agent!.agentId, commandId: p.data.commandId }, "результат для неизвестной команды");
			res.json({ success: true, data: { ok: true, ignored: true } });
			return;
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
		// Экземпляр из details ошибки БОЛЬШЕ НЕ ЗАВОДИМ. Это была замена ещё не
		// реализованного X-Agent-Instance; теперь агент шлёт заголовок, а «host#pid»
		// заводил ВТОРУЮ запись для того же процесса — и список экземпляров показывал
		// один процесс дважды, под разными именами. Машина и процесс из details
		// по-прежнему видны в тексте ошибки (describeResponder).
		// Публикация и её снятие — сразу в реестр: иначе состояние обновилось бы только
		// ближайшим полным срезом, а пользователь ждёт результата здесь и сейчас.
		if (p.data.status === "SUCCESS" && row.base_key
			&& (row.type === "IB_PUBLISH" || row.type === "IB_UNPUBLISH")) {
			const published = row.type === "IB_PUBLISH";
			const url = published ? (p.data.result as { url?: string } | null)?.url ?? null : null;
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId) await bases.setPublication(me.serverId, row.base_key, published, url);
		}
		// Срез публикаций может прийти и не из ручки панели (пакет, повтор задания) —
		// применяем его на общем пути приёма результатов.
		if (p.data.status === "SUCCESS" && row.type === "CLUSTER_LIST_PUBLICATIONS") {
			const data = p.data.result as { items?: { key: string; published?: boolean; url?: string | null }[]; complete?: boolean } | null;
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId && Array.isArray(data?.items) && data.items.length) {
				await bases.applyPublications(me.serverId, data.items, data.complete === true);
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
		const REFRESH_AFTER: Record<string, "IB_LIST_USERS" | "IB_LIST_EXTENSIONS"> = {
			IB_CREATE_USER: "IB_LIST_USERS",
			IB_UPDATE_USER: "IB_LIST_USERS",
			IB_DELETE_USER: "IB_LIST_USERS",
			IB_INSTALL_EXTENSION: "IB_LIST_EXTENSIONS",
			IB_DELETE_EXTENSION: "IB_LIST_EXTENSIONS",
		};
		const refreshType = REFRESH_AFTER[row.type];
		if (p.data.status === "SUCCESS" && refreshType && row.base_key) {
			await queue.enqueue({
				agentId: req.agent!.agentId,
				organizationUuid: row.organization_uuid,
				baseKey: row.base_key,
				type: refreshType,
				payload: { baseKey: row.base_key },
				requestId: `refresh:${refreshType}:${row.base_key}`,
				ttlSeconds: 900,
			});
		}
		// База, которой нет: агент сообщил «не найдена». Помечаем в реестре — иначе фантом
		// остаётся в списке наравне с рабочими, и о проблеме узнают только по ошибке при
		// каждой попытке. Обратно в ONLINE её вернёт ближайший успешный срез кластера.
		if (p.data.status === "ERROR" && p.data.error?.code === "INFOBASE_NOT_FOUND" && row.base_key) {
			const me = await agents.findById(req.agent!.agentId);
			if (me?.serverId) await bases.markStatus(me.serverId, row.base_key, "MISSING");
		}
		// Списки содержимого базы оседают в кэше здесь, а не в HTTP-ручке панели: тем же
		// путём приходят результаты ПАКЕТНОЙ проверки, которую никто не ждёт в запросе.
		if (p.data.status === "SUCCESS" && row.base_key && (row.type === "IB_LIST_USERS" || row.type === "IB_LIST_EXTENSIONS")) {
			const items = (p.data.result as { items?: unknown[] } | null)?.items;
			if (Array.isArray(items)) {
				const base = await bases.findByKeyGlobal(row.base_key);
				if (base) {
					if (row.type === "IB_LIST_USERS") await registry.syncUsers(base.id, items as IbUser[]);
					else await registry.syncExtensions(base.id, items as IbExtension[]);
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
