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

const registerSchema = z.object({
	agentId: z.string().uuid(),
	agentName: z.string().max(200).optional().default(""),
	version: z.string().max(50),
	os: z.string().max(50).optional().default(""),
	capabilities: z.array(z.string().max(50)).max(100).optional().default([]),
});

const heartbeatSchema = z.object({
	agentId: z.string().uuid(),
	version: z.string().max(50).optional(),
	status: z.string().max(20),
	onec: z.object({ reachable: z.boolean(), version: z.string().nullable().optional() }).optional(),
	commandsDone: z.number().int().optional(),
	commandsFailed: z.number().int().optional(),
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

export function agentRouter(deps: { db: Db; cfg: Config; log: Logger; agents: AgentService; queue: CommandQueue; audit: Audit }) {
	const { db, cfg, log, agents, queue, audit } = deps;
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
		await agents.register(req.agent!.agentId, {
			name: p.data.agentName, version: p.data.version, os: p.data.os, capabilities: p.data.capabilities,
		});
		log.info({ agentId: req.agent!.agentId, version: p.data.version }, "агент зарегистрирован");
		await audit.write({ event: "agent.register", agentId: req.agent!.agentId, organizationUuid: req.agent!.organizationUuid,
			details: { version: p.data.version, os: p.data.os, capabilities: p.data.capabilities.length } });
		res.json({ success: true, data: { ok: true, pollMaxWaitSecs: cfg.POLL_MAX_WAIT_SECS } });
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
		res.json({ success: true, data: { ok: true } });
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
