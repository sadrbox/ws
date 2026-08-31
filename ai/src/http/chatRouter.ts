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
import { rateLimit } from "./rateLimit.ts";

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

export function chatRouter(deps: { workflow: ChatWorkflow; log: Logger; maxAttachmentBytes?: number; chatPerMin?: number; attachmentsPerMin?: number }) {
	const { workflow, log } = deps;
	const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1048576;
	const r = Router();

	// Лимиты на пользователя: ходы чата и отдельно ходы с вложениями (каждое — вызов модели с PDF).
	const chatLimiter = rateLimit({ max: deps.chatPerMin ?? 30, windowMs: 60_000, message: "Слишком много сообщений подряд — подождите минуту" });
	const attachmentLimiter = rateLimit({
		max: deps.attachmentsPerMin ?? 6, windowMs: 60_000,
		applies: (req) => Array.isArray((req.body as { attachments?: unknown[] } | undefined)?.attachments) && ((req.body as { attachments: unknown[] }).attachments.length > 0),
		message: "Слишком много вложений подряд — подождите минуту",
	});

	r.post("/chat", chatLimiter, attachmentLimiter, async (req, res) => {
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
			const user = { uuid: u.uuid, organizationUuid };
			if (attachments.length) {
				// Вложения распознаются минутами — ответ сразу, результат клиент заберёт из состояния диалога.
				const id = await workflow.prepare(user, p.data.conversationId ?? null);
				void workflow.handleInBackground(user, id, p.data.text, attachments);
				res.json({ success: true, data: { conversationId: id, state: "PROCESSING", text: `Читаю ${attachments.length === 1 ? "выписку" : "выписки"}… Это займёт до пары минут; ответ появится здесь.` } });
				return;
			}
			// Обычный ход тоже может затянуться (несколько раундов модели + 1С); прокси по дороге
			// держат соединение ~100 с. Не успели за 45 с — отвечаем PROCESSING, ход продолжается
			// в фоне, клиент дочитает результат из состояния диалога.
			const id = await workflow.prepare(user, p.data.conversationId ?? null);
			const work = workflow.handle(user, id, p.data.text, attachments);
			const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000));
			const reply = await Promise.race([work, timeout]);
			if (reply) {
				res.json({ success: true, data: reply });
				return;
			}
			work.catch((e) => log.error({ err: e, conversationId: id }, "фоновый ход завершился ошибкой"));
			res.json({ success: true, data: { conversationId: id, state: "PROCESSING", text: "Ещё работаю… ответ появится здесь через несколько секунд." } });
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
