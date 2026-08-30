// Чат пользователей ERP.
//
//   POST /v1/chat                       {conversationId?, text} → ответ модели/подтверждение
//   GET  /v1/conversations/:id          история диалога (только текстовые ходы)
//
// Один ход может занимать десятки секунд (модель + 1С), поэтому ответ синхронный, но
// с большим таймаутом сервера; SSE-стриминг — отдельным шагом при интеграции во фронт.

import { Router } from "express";
import { z } from "zod";
import type { ChatWorkflow } from "../chat/workflow.ts";
import { WorkflowError } from "../chat/workflow.ts";
import type { Logger } from "../logger.ts";

const attachmentSchema = z.object({
	fileName: z.string().trim().min(1).max(200),
	mimeType: z.string().trim().max(100),
	/** base64 содержимого файла. */
	content: z.string().min(1),
});

const chatSchema = z.object({
	conversationId: z.string().uuid().optional().nullable(),
	// Текст может быть пустым, если приложен файл: «вот выписка» и так понятно.
	text: z.string().trim().max(4000).default(""),
	/** Организация диалога; по умолчанию — активная у пользователя в ERP. Только из доступных ему. */
	organizationUuid: z.string().uuid().optional().nullable(),
	/** Вложения (PDF выписок). Не больше трёх за одно сообщение. */
	attachments: z.array(attachmentSchema).max(3).optional(),
}).refine((v) => v.text.length > 0 || (v.attachments?.length ?? 0) > 0, { message: "нужен текст или вложение" });

export function chatRouter(deps: { workflow: ChatWorkflow; log: Logger; maxAttachmentBytes?: number }) {
	const { workflow, log } = deps;
	const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1048576;
	const r = Router();

	r.post("/chat", async (req, res) => {
		const p = chatSchema.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Нужен text (до 4000 символов) или вложение" } });
			return;
		}
		const attachments = (p.data.attachments ?? []).map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, content: Buffer.from(a.content, "base64") }));
		const tooBig = attachments.find((a) => a.content.length > maxAttachmentBytes);
		if (tooBig) {
			res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: `Файл «${tooBig.fileName}» больше ${Math.round(maxAttachmentBytes / 1048576)} МБ` } });
			return;
		}
		const u = req.erpUser!;
		const requested = p.data.organizationUuid ?? null;
		if (requested && !u.isSuperAdmin && !u.allowedOrgUuids.includes(requested)) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа к этой организации" } });
			return;
		}
		const organizationUuid = requested ?? u.organizationUuid;
		if (!organizationUuid) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		// Ход может быть долгим: модель + очередь + 1С.
		req.setTimeout(300_000);
		try {
			const reply = await workflow.handle({ uuid: u.uuid, organizationUuid }, p.data.conversationId ?? null, p.data.text, attachments);
			res.json({ success: true, data: reply });
		} catch (e) {
			if (e instanceof WorkflowError) {
				res.status(e.code === "NOT_FOUND" ? 404 : 400).json({ success: false, error: { code: e.code, message: e.message } });
				return;
			}
			log.error({ err: e, user: u.uuid }, "ошибка чата");
			res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } });
		}
	});

	r.get("/conversations", async (req, res) => {
		const u = req.erpUser!;
		const requested = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid : null;
		const org = requested && (u.isSuperAdmin || u.allowedOrgUuids.includes(requested)) ? requested : u.organizationUuid;
		if (!org) {
			res.json({ success: true, data: { items: [] } });
			return;
		}
		res.json({ success: true, data: { items: await workflow.list({ uuid: u.uuid, organizationUuid: org }) } });
	});

	r.get("/conversations/:id", async (req, res) => {
		const u = req.erpUser!;
		if (!u.organizationUuid || !z.string().uuid().safeParse(req.params.id).success) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Диалог не найден" } });
			return;
		}
		const requested = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid : null;
		const org = requested && (u.isSuperAdmin || u.allowedOrgUuids.includes(requested)) ? requested : u.organizationUuid;
		const s = await workflow.summary(req.params.id, { uuid: u.uuid, organizationUuid: org });
		if (!s) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Диалог не найден" } });
			return;
		}
		res.json({ success: true, data: s });
	});

	return r;
}
