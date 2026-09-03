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
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import { type BaseService, type BaseState, needsFullBases } from "../bases/service.ts";

// Состояние одной базы в register/heartbeat (E15/A2). Незаполненное поле значит «не знаю»:
// список баз и версию платформы даёт админ-агент, версию расширения — бизнес-агент, и
// затирать чужие данные своими пропусками нельзя.
const baseStateSchema = z.object({
	key: z.string().min(1).max(200),
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
	status: z.string().max(20),
	onec: z.object({ reachable: z.boolean(), version: z.string().nullable().optional() }).optional(),
	commandsDone: z.number().int().optional(),
	commandsFailed: z.number().int().optional(),
	// v2: состояния баз. basesComplete=true — это полный срез, иначе только изменившиеся.
	bases: z.array(baseStateSchema).max(500).optional(),
	basesComplete: z.boolean().optional(),
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

export function agentRouter(deps: { db: Db; cfg: Config; log: Logger; agents: AgentService; bases: BaseService; queue: CommandQueue; audit: Audit }) {
	const { db, cfg, log, agents, bases, queue, audit } = deps;
	const r = Router();
	r.use(requireAgent(db));

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
		const role = p.data.role ?? "business";
		const server = await bases.ensureServer(req.agent!.organizationUuid, p.data.server?.name ?? "",
			{ host: p.data.server?.rasHost ?? null, port: p.data.server?.rasPort ?? null });
		await agents.register(req.agent!.agentId, {
			name: p.data.agentName, version: p.data.version, os: p.data.os, capabilities: p.data.capabilities,
			role, serverId: server.id,
		});
		if (p.data.bases?.length) {
			await bases.sync(server.id, p.data.bases as BaseState[], { complete: true, authoritative: role === "admin" });
			await agents.markBasesSynced(req.agent!.agentId);
		}
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
		await agents.heartbeat(req.agent!.agentId, {
			status: p.data.status,
			version: p.data.version,
			onecReachable: p.data.onec?.reachable ?? false,
			onecVersion: p.data.onec?.version ?? null,
		});

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
		const commands = await queue.take(req.agent!.agentId, wait);
		if (closed && commands.length) {
			await db.query(`UPDATE commands SET state = 'queued', dispatched_at = NULL WHERE id = ANY($1) AND state = 'dispatched'`,
				[commands.map((c) => c.id)]);
			return;
		}
		if (commands.length) log.info({ agentId: req.agent!.agentId, count: commands.length }, "команды выданы агенту");
		res.json({ commands });
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
		log.info({ commandId: row.id, status: p.data.status, code: p.data.error?.code }, "результат команды");
		await audit.write({ event: "command.result", agentId: row.agent_id, organizationUuid: row.organization_uuid,
			userUuid: row.user_uuid, conversationId: row.conversation_id, commandId: row.id, requestId: row.request_id,
			details: { type: row.type, status: p.data.status, code: p.data.error?.code ?? null, onecHttpStatus: p.data.onecHttpStatus ?? null } });
		res.json({ success: true, data: { ok: true } });
	});

	return r;
}
