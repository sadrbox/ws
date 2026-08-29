// Административный API (X-Admin-Key): регистрация агентов и служебные операции.
//
//   POST   /admin/v1/agents                  {organizationUuid, name} → агент + токен (один раз)
//   GET    /admin/v1/agents
//   POST   /admin/v1/agents/:id/rotate-token
//   POST   /admin/v1/agents/:id/disable | /enable
//   POST   /admin/v1/commands                {agentId, type, payload, requestId?} → команда
//   GET    /admin/v1/commands/:id            состояние и результат
//
// Отправка команд отсюда — для e2e-тестов и ручной диагностики: боевой путь команд идёт
// через диалог пользователя (chat), где действуют whitelist tools и подтверждения §17.

import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireAdmin } from "../auth/index.ts";
import type { AgentService } from "../agents/service.ts";
import { CommandQueue } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";

const createAgentSchema = z.object({
	organizationUuid: z.string().min(1).max(64),
	name: z.string().max(200).optional().default(""),
});

const commandSchema = z.object({
	agentId: z.string().uuid(),
	type: z.string().min(1).max(50),
	payload: z.record(z.string(), z.unknown()).optional().default({}),
	requestId: z.string().uuid().optional(),
	ttlSeconds: z.number().int().min(30).max(86_400).optional(),
});

export function adminRouter(deps: { cfg: Config; log: Logger; agents: AgentService; queue: CommandQueue; audit: Audit }) {
	const { cfg, log, agents, queue, audit } = deps;
	const r = Router();
	r.use(requireAdmin(cfg.AGENT_ADMIN_KEY));

	r.post("/agents", async (req, res) => {
		const p = createAgentSchema.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "organizationUuid обязателен" } });
			return;
		}
		const { agent, token } = await agents.create(p.data.organizationUuid, p.data.name);
		log.info({ agentId: agent.id, organizationUuid: agent.organizationUuid }, "агент создан");
		await audit.write({ event: "agent.create", agentId: agent.id, organizationUuid: agent.organizationUuid });
		res.status(201).json({ success: true, data: { agent, token, note: "Токен показывается один раз. Впишите его в agent.toml: cloud.token" } });
	});

	r.get("/agents", async (_req, res) => {
		res.json({ success: true, data: { items: await agents.listAll() } });
	});

	r.post("/agents/:id/rotate-token", async (req, res) => {
		const token = await agents.rotateToken(req.params.id);
		if (!token) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Агент не найден" } });
			return;
		}
		await audit.write({ event: "agent.rotate_token", agentId: req.params.id });
		res.json({ success: true, data: { token } });
	});

	for (const action of ["disable", "enable"] as const) {
		r.post(`/agents/:id/${action}`, async (req, res) => {
			const ok = await agents.setDisabled(req.params.id, action === "disable");
			if (!ok) {
				res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Агент не найден" } });
				return;
			}
			await audit.write({ event: `agent.${action}`, agentId: req.params.id });
			res.json({ success: true, data: { ok: true } });
		});
	}

	r.post("/commands", async (req, res) => {
		const p = commandSchema.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректная команда", details: p.error.issues } });
			return;
		}
		const agent = await agents.get(p.data.agentId);
		if (!agent) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Агент не найден" } });
			return;
		}
		const cmd = await queue.enqueue({
			agentId: agent.id, organizationUuid: agent.organizationUuid, type: p.data.type,
			payload: p.data.payload, requestId: p.data.requestId ?? null, ttlSeconds: p.data.ttlSeconds,
		});
		await audit.write({ event: "command.enqueue", agentId: agent.id, organizationUuid: agent.organizationUuid,
			commandId: cmd.id, requestId: cmd.request_id, details: { type: cmd.type, source: "admin" } });
		res.status(201).json({ success: true, data: CommandQueue.toView(cmd) });
	});

	r.get("/commands/:id", async (req, res) => {
		const waitMs = Math.min(Number.parseInt(String(req.query.wait ?? "0"), 10) || 0, 120) * 1000;
		const cmd = waitMs ? await queue.waitResult(req.params.id, waitMs) : await queue.get(req.params.id);
		if (!cmd) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Команда не найдена" } });
			return;
		}
		res.json({ success: true, data: CommandQueue.toView(cmd) });
	});

	return r;
}
