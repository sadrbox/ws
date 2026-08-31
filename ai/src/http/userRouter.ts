// API пользователей ERP (JWT бэкенда). Первый прирост — только сведения об агентах своей
// организации; диалог с LLM добавится в chat/ следующим циклом и смонтируется сюда же.
//
//   GET /v1/me            кто я с точки зрения AI Service (uuid, активная организация)
//   GET /v1/agents        агенты активной организации и их состояние (1С доступна?)
//   GET /v1/status        сводка для панели: сервис, модель (последняя ошибка), агент и база 1С
//   POST /v1/chat, GET /v1/conversations/:id — см. chatRouter (если LLM настроена)

import { Router } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import { requireErpUser } from "../auth/index.ts";
import type { AgentService } from "../agents/service.ts";
import type { ChatWorkflow } from "../chat/workflow.ts";
import type { Logger } from "../logger.ts";
import type { FileStore } from "../files/store.ts";
import { chatRouter } from "./chatRouter.ts";
import { llmHealth } from "../llm/health.ts";

export function userRouter(deps: { erp: Db; cfg: Config; agents: AgentService; workflow: ChatWorkflow | null; log: Logger; files: FileStore; version: string }) {
	const { erp, cfg, agents, workflow, log, files, version } = deps;
	const r = Router();
	r.use(requireErpUser(erp, cfg.JWT_SECRET));
	if (workflow) r.use(chatRouter({ workflow, log, maxAttachmentBytes: cfg.CHAT_ATTACHMENT_MAX_MB * 1048576, chatPerMin: cfg.RATE_LIMIT_CHAT_PER_MIN, attachmentsPerMin: cfg.RATE_LIMIT_ATTACHMENTS_PER_MIN }));

	r.get("/me", (req, res) => {
		const u = req.erpUser!;
		res.json({ success: true, data: { uuid: u.uuid, organizationUuid: u.organizationUuid, isOrgAdmin: u.isOrgAdmin, isSuperAdmin: u.isSuperAdmin } });
	});

	// Файл диалога (печатная форма, отчёт): только своей организации, пока не истёк срок хранения.
	r.get("/files/:id", async (req, res) => {
		const u = req.erpUser!;
		const requested = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid : null;
		const org = requested && (u.isSuperAdmin || u.allowedOrgUuids.includes(requested)) ? requested : u.organizationUuid;
		const f = org && /^[0-9a-f-]{36}$/i.test(req.params.id) ? await files.get(req.params.id, org) : null;
		if (!f) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Файл не найден или срок его хранения истёк" } });
			return;
		}
		res.setHeader("Content-Type", f.mimeType);
		res.setHeader("Content-Length", String(f.size));
		res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
		res.setHeader("Cache-Control", "private, max-age=3600");
		res.end(f.content);
	});

	r.get("/agents", async (req, res) => {
		const org = req.erpUser!.organizationUuid;
		if (!org) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		const items = (await agents.visibleTo(org)).map((a) => ({
			id: a.id, name: a.name, status: a.status, online: a.online, onec: a.onec, version: a.version, lastSeenAt: a.lastSeenAt,
		}));
		res.json({ success: true, data: { items } });
	});

	// Панель статуса в чате: одна сводка вместо трёх запросов. Агент и база — по активной
	// организации; модель — по последнему обращению к провайдеру (см. llm/health.ts).
	r.get("/status", async (req, res) => {
		const org = req.erpUser!.organizationUuid;
		const list = org ? await agents.visibleTo(org) : [];
		const items = list.map((a) => ({ id: a.id, name: a.name, online: a.online, onec: a.onec, version: a.version, lastSeenAt: a.lastSeenAt }));
		const a = items.find((x) => x.online && x.onec.reachable) ?? items.find((x) => x.online) ?? items[0] ?? null;
		res.json({
			success: true,
			data: {
				service: { version, chat: workflow !== null, model: cfg.LLM_MODEL },
				llm: llmHealth(),
				agent: a ? { configured: true, online: a.online, name: a.name, version: a.version, lastSeenAt: a.lastSeenAt } : { configured: false, online: false, name: null, version: null, lastSeenAt: null },
				onec: { reachable: a?.online === true && a.onec.reachable, version: a?.onec.version ?? null },
				organizationSelected: Boolean(org),
				at: new Date().toISOString(),
			},
		});
	});

	return r;
}
