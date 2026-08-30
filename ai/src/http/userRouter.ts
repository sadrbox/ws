// API пользователей ERP (JWT бэкенда). Первый прирост — только сведения об агентах своей
// организации; диалог с LLM добавится в chat/ следующим циклом и смонтируется сюда же.
//
//   GET /v1/me            кто я с точки зрения AI Service (uuid, активная организация)
//   GET /v1/agents        агенты активной организации и их состояние (1С доступна?)
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

export function userRouter(deps: { erp: Db; cfg: Config; agents: AgentService; workflow: ChatWorkflow | null; log: Logger; files: FileStore }) {
	const { erp, cfg, agents, workflow, log, files } = deps;
	const r = Router();
	r.use(requireErpUser(erp, cfg.JWT_SECRET));
	if (workflow) r.use(chatRouter({ workflow, log, maxAttachmentBytes: cfg.CHAT_ATTACHMENT_MAX_MB * 1048576 }));

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

	return r;
}
