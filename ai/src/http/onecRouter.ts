// Администрирование 1С для панели aleppo.kz (E15/A3, A5-P0).
//
//   GET  /v1/onec/bases                      реестр баз (из БД, без обращения к кластеру)
//   POST /v1/onec/bases/refresh              перечитать список баз у админ-агента (rac)
//   GET  /v1/onec/bases/:key/info            сведения о базе
//   GET  /v1/onec/sessions?baseKey=…         сеансы кластера или одной базы
//   GET  /v1/onec/connections?baseKey=…      соединения
//   POST /v1/onec/sessions/:id/terminate     снять сеанс                (CRITICAL)
//   POST /v1/onec/bases/:key/lock            блокировка начала сеансов  (CRITICAL)
//
// Список баз отдаётся ИЗ БАЗЫ СЕРВИСА, а не запросом в кластер на каждый показ: сто баз
// опрашивать при каждом открытии панели незачем — состояние приходит с heartbeat. Кнопка
// «обновить» существует ровно для случая, когда ждать heartbeat не хочется.
//
// Права: пока администратор организации или суперадмин. Именованное право OneCAdmin
// заводится в ERP вместе с панелью (A5) — тогда проверка переедет на него.

import { Router, type Request, type Response } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireErpUser } from "../auth/index.ts";
import { rateLimit } from "./rateLimit.ts";
import type { AgentService } from "../agents/service.ts";
import type { BaseService, BaseState } from "../bases/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import { type AdminCommandSpec, agentCanRun, buildAdminPayload, findAdminCommand } from "../commands/admin.ts";

type Deps = {
	erp: Db;
	cfg: Config;
	log: Logger;
	agents: AgentService;
	bases: BaseService;
	queue: CommandQueue;
	audit: Audit;
};

/** Итог админ-команды: HTTP-статус и тело в общем конверте {success, data|error}. */
type Outcome = { status: number; body: Record<string, unknown>; data?: unknown };

const fail = (status: number, code: string, message: string): Outcome =>
	({ status, body: { success: false, error: { code, message } } });

export function onecRouter(deps: Deps) {
	const { erp, cfg, log, agents, bases, queue, audit } = deps;
	const r = Router();
	r.use(requireErpUser(erp, cfg.JWT_SECRET));

	// Предел частоты — на ОРГАНИЗАЦИЮ: кластер один на всех её администраторов, и защищать
	// нужно именно его, а не пользователя. Локальное чтение реестра баз (GET /bases) не
	// считается: оно отвечает из своей БД и до rac не доходит.
	r.use(rateLimit({
		max: cfg.RATE_LIMIT_ONEC_CLUSTER_PER_MIN,
		windowMs: 60_000,
		key: (req) => req.erpUser?.organizationUuid ?? req.erpUser?.uuid ?? req.ip ?? "anonymous",
		applies: (req) => !(req.method === "GET" && req.path === "/bases"),
		message: "Слишком часто обращаемся к кластеру 1С — подождите немного",
	}));

	r.use((req, res, next) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin && !u.isOrgAdmin) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Нужны права администратора организации" } });
			return;
		}
		if (!u.organizationUuid) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		next();
	});

	/**
	 * Общий путь админ-команды: проверка payload → выбор админ-агента (по базе, если она
	 * указана) → гейт по capabilities → очередь → ожидание результата.
	 *
	 * Результат отдаётся синхронно: панель показывает сеансы здесь и сейчас, а не «команда
	 * поставлена». Если агент не ответил вовремя — это TIMEOUT, но команда ОСТАЁТСЯ в очереди
	 * и, скорее всего, выполнится; для CRITICAL текст говорит об этом прямо, иначе оператор
	 * повторит снятие сеанса, который уже снят.
	 */
	async function run(req: Request, type: string, input: unknown): Promise<Outcome> {
		const u = req.erpUser!;
		const org = u.organizationUuid!;
		const spec: AdminCommandSpec | null = findAdminCommand(type);
		if (!spec) return fail(400, "UNKNOWN_COMMAND", `Команда ${type} не поддерживается`);

		const built = buildAdminPayload(spec, input);
		if (!built.ok) return fail(400, "VALIDATION_ERROR", built.message);

		const agent = await agents.pickAgentFor(org, built.baseKey, spec.role);
		if (!agent) {
			return fail(409, "ADMIN_AGENT_UNAVAILABLE", built.baseKey
				? `Для базы «${built.baseKey}» нет админ-агента на связи`
				: "Админ-агент 1С не настроен или не на связи");
		}
		if (!agentCanRun(agent, spec)) {
			return fail(409, "CAPABILITY_MISSING", `Агент не умеет «${spec.title}»: нет способности ${spec.capability}`);
		}

		const cmd = await queue.enqueue({
			agentId: agent.id,
			organizationUuid: org,
			baseKey: built.baseKey,
			type: spec.type,
			payload: built.payload,
			userUuid: u.uuid,
			ttlSeconds: 300,
		});
		await audit.write({
			event: "onec.admin",
			organizationUuid: org,
			userUuid: u.uuid,
			agentId: agent.id,
			commandId: cmd.id,
			details: { type: spec.type, operation: spec.operation, baseKey: built.baseKey, title: spec.title },
		});
		log.info({ type: spec.type, baseKey: built.baseKey, agentId: agent.id, userUuid: u.uuid }, "админ-команда 1С");

		const done: CommandRow | null = await queue.waitResult(cmd.id, cfg.CHAT_COMMAND_TIMEOUT_SECS * 1000);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return fail(504, "TIMEOUT", spec.operation === "CRITICAL"
				? "Агент не ответил вовремя. Команда осталась в очереди и, скорее всего, будет выполнена — проверьте состояние перед повтором"
				: "Агент 1С не ответил вовремя");
		}
		if (done.state !== "done") {
			const e = done.error ?? { code: "COMMAND_FAILED", message: "Команда не выполнена" };
			return { status: 502, body: { success: false, error: e } };
		}
		return { status: 200, body: { success: true, data: done.result ?? null }, data: done.result ?? null };
	}

	const send = (res: Response, o: Outcome) => { res.status(o.status).json(o.body); };

	r.get("/bases", async (req, res) => {
		const items = await bases.listByOrganization(req.erpUser!.organizationUuid!);
		res.json({ success: true, data: { items } });
	});

	// Ручное обновление реестра: спрашиваем список у кластера и сразу применяем к базе сервиса,
	// чтобы панель обновилась в этом же запросе, не дожидаясь ближайшего heartbeat.
	r.post("/bases/refresh", async (req, res) => {
		const org = req.erpUser!.organizationUuid!;
		const agent = await agents.pickAgentFor(org, null, "admin");
		const outcome = await run(req, "CLUSTER_LIST_INFOBASES", {});
		const items = (outcome.data as { items?: BaseState[] } | null)?.items;
		if (outcome.status === 200 && agent?.serverId && Array.isArray(items) && items.length) {
			await bases.sync(agent.serverId, items, { complete: true, authoritative: true });
			send(res, { status: 200, body: { success: true, data: { items: await bases.listByOrganization(org) } } });
			return;
		}
		send(res, outcome);
	});

	r.get("/bases/:key/info", async (req, res) => {
		send(res, await run(req, "CLUSTER_INFOBASE_INFO", { baseKey: req.params.key }));
	});

	r.get("/sessions", async (req, res) => {
		const filter = typeof req.query.baseKey === "string" && req.query.baseKey ? { baseKey: req.query.baseKey } : {};
		send(res, await run(req, "CLUSTER_LIST_SESSIONS", filter));
	});

	r.get("/connections", async (req, res) => {
		const filter = typeof req.query.baseKey === "string" && req.query.baseKey ? { baseKey: req.query.baseKey } : {};
		send(res, await run(req, "CLUSTER_LIST_CONNECTIONS", filter));
	});

	r.post("/sessions/:id/terminate", async (req, res) => {
		const body = (req.body ?? {}) as { baseKey?: string };
		send(res, await run(req, "CLUSTER_TERMINATE_SESSION", {
			sessionId: req.params.id,
			...(body.baseKey ? { baseKey: body.baseKey } : {}),
		}));
	});

	r.post("/bases/:key/lock", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "CLUSTER_SET_SESSIONS_LOCK", { ...body, baseKey: req.params.key }));
	});

	return r;
}
