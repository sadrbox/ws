// Канал «чат внутри 1С» (СВ1, СВ2; контракт — docs/CONTRACT_1C_CHAT_2026-09-19.md).
//
//   GET  /v1/onec-chat/ping                 проверка связи и токена: база, организация ERP, версия сервиса
//   POST /v1/onec-chat/turn                 ход диалога: текст | вложения | decision | toolResults
//   GET  /v1/onec-chat/conversations        диалоги пользователя 1С в этой базе
//   GET  /v1/onec-chat/conversations/:id    диалог: сообщения, состояние, карточка, ожидающие calls
//
// Субъект — пара «база + пользователь ИБ» (X-Base-Token + X-1C-User-Id, requireOnecUser). Имя пользователя и
// организация 1С — в теле хода: заголовки только ASCII. Инструменты выполняет форма (state TOOL_CALLS) —
// агент для этого канала не нужен.

import { Router, type Request } from "express";
import { z } from "zod";
import type { ChatWorkflow, ChatReply, ChatUser, OnecOrganization, WorkflowState } from "../chat/workflow.ts";
import { WorkflowError } from "../chat/workflow.ts";
import { requireOnecUser } from "../auth/index.ts";
import type { BaseTokenStore } from "../bases/tokens.ts";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import { rateLimit } from "./rateLimit.ts";

/** Версия протокола канала: форма показывает её в «Проверить связь». */
export const ONEC_CHAT_PROTOCOL = "onec-chat/1";

const attachmentSchema = z.object({
	fileName: z.string().trim().min(1).max(200),
	mimeType: z.string().trim().max(100).default("application/pdf"),
	content: z.string().min(1),
});

const toolResultSchema = z.object({
	callId: z.string().min(1).max(200),
	result: z.object({
		success: z.boolean(),
		data: z.unknown().optional(),
		error: z.object({ code: z.string().max(100).optional(), message: z.string().max(20_000).optional(), details: z.unknown().optional() }).nullable().optional(),
		status: z.number().int().optional(),
	}),
});

const turnSchema = z.object({
	conversationId: z.string().uuid().nullable().optional(),
	user: z.object({ id: z.string().uuid(), name: z.string().trim().max(200).default("") }),
	organization: z.object({
		bin: z.string().trim().max(20).nullable().optional(),
		name: z.string().trim().max(300).nullable().optional(),
		id: z.string().trim().max(100).nullable().optional(),
	}).nullable().optional(),
	text: z.string().trim().max(4000).default(""),
	attachments: z.array(attachmentSchema).max(3).optional(),
	decision: z.object({ accepted: z.boolean() }).nullable().optional(),
	toolResults: z.array(toolResultSchema).max(50).optional(),
});

/**
 * Состояние для клиента. Внутренние переходные (разбор, исполнение) для формы — «ход идёт», новый пустой диалог —
 * «завершён»: форме нужен ровно список из контракта.
 */
export function clientState(state: WorkflowState | "PROCESSING"): string {
	if (state === "UNDERSTANDING" || state === "RESOLVING_ENTITIES" || state === "EXECUTING") return "PROCESSING";
	if (state === "IDLE") return "COMPLETED";
	return state;
}

/** Ответ хода в форме контракта: служебного (usage, ссылки на файлы сервиса) форме не отдаём. */
function toClient(r: ChatReply): Record<string, unknown> {
	return {
		conversationId: r.conversationId,
		state: clientState(r.state),
		text: r.text ?? "",
		...(r.confirmation ? { confirmation: r.confirmation } : {}),
		...(r.calls?.length ? { calls: r.calls } : {}),
		...(r.documents?.length ? { documents: r.documents } : {}),
	};
}

export function onecChatRouter(deps: {
	workflow: ChatWorkflow | null;
	tokens: Pick<BaseTokenStore, "resolve">;
	erp: Db;
	log: Logger;
	version: string;
	maxAttachmentBytes?: number;
	chatPerMin?: number;
	attachmentsPerMin?: number;
	/** Сколько держать ход до ответа PROCESSING (форма ждёт до 120 с). */
	turnTimeoutMs?: number;
}) {
	const { workflow, tokens, erp, log, version } = deps;
	const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1048576;
	const turnTimeoutMs = deps.turnTimeoutMs ?? 90_000;
	const r = Router();
	r.use(requireOnecUser(tokens));

	// Лимиты — на пару «база + пользователь 1С». Сообщения человека (текст, вложения, решение по карточке) —
	// обычным лимитом чата; ходы с результатами вызовов идут без участия человека и каждый зовёт модель,
	// поэтому для них отдельный, более широкий лимит — но не бесконечный.
	const pairKey = (req: Request) => `${req.onecUser!.baseId}:${req.onecUser!.userId}`;
	const isResults = (req: Request) => Array.isArray((req.body as { toolResults?: unknown[] } | undefined)?.toolResults) && (req.body as { toolResults: unknown[] }).toolResults.length > 0;
	const chatPerMin = deps.chatPerMin ?? 30;
	const messageLimiter = rateLimit({ max: chatPerMin, windowMs: 60_000, key: pairKey, applies: (req) => !isResults(req), message: "Слишком много сообщений подряд — подождите минуту" });
	const resultsLimiter = rateLimit({ max: chatPerMin > 0 ? chatPerMin * 4 : 0, windowMs: 60_000, key: pairKey, applies: isResults, message: "Слишком много шагов подряд — подождите минуту" });
	const attachmentLimiter = rateLimit({
		max: deps.attachmentsPerMin ?? 6, windowMs: 60_000, key: pairKey,
		applies: (req) => Array.isArray((req.body as { attachments?: unknown[] } | undefined)?.attachments) && ((req.body as { attachments: unknown[] }).attachments.length > 0),
		message: "Слишком много вложений подряд — подождите минуту",
	});

	r.get("/ping", async (req, res) => {
		const u = req.onecUser!;
		let orgName: string | null = null;
		try {
			const o = await erp.query<{ name: string | null; legal_name: string | null }>(`SELECT name, "legalName" AS legal_name FROM organizations WHERE uuid = $1`, [u.organizationUuid]);
			orgName = o.rows[0]?.name ?? o.rows[0]?.legal_name ?? null;
		} catch (e) {
			log.warn({ err: e }, "ping 1С: не прочитана организация ERP");
		}
		res.json({ success: true, data: {
			base: { key: u.baseKey, name: u.baseName },
			organization: { uuid: u.organizationUuid, name: orgName },
			serviceVersion: version,
			protocol: ONEC_CHAT_PROTOCOL,
			chat: !!workflow,
		} });
	});

	const noChat = (res: import("express").Response) => res.status(503).json({ success: false, error: { code: "CHAT_DISABLED", message: "Чат в сервисе не настроен (нет модели)" } });

	r.post("/turn", messageLimiter, resultsLimiter, attachmentLimiter, async (req, res) => {
		if (!workflow) {
			noChat(res);
			return;
		}
		const p = turnSchema.safeParse(req.body);
		if (!p.success) {
			const issue = p.error.issues[0];
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Некорректный ход: ${issue ? `${issue.path.join(".") || "тело"} — ${issue.message}` : "тело запроса"}` } });
			return;
		}
		const b = p.data;
		const u = req.onecUser!;
		const bad = (message: string) => res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message } });
		if (b.user.id.toLowerCase() !== u.userId) {
			bad("user.id не совпадает с X-1C-User-Id");
			return;
		}
		const results = b.toolResults ?? [];
		const attachmentsIn = b.attachments ?? [];
		// Ход — ровно одно действие: сообщение (текст и/или вложения), решение по карточке или результаты вызовов.
		const kinds = [b.text.length > 0 || attachmentsIn.length > 0, !!b.decision, results.length > 0].filter(Boolean).length;
		if (kinds !== 1) {
			bad(kinds ? "В одном ходе — либо текст/вложения, либо decision, либо toolResults" : "Нужен text, вложение, decision или toolResults");
			return;
		}
		if ((b.decision || results.length) && !b.conversationId) {
			bad("decision и toolResults относятся к существующему диалогу — нужен conversationId");
			return;
		}
		const attachments = attachmentsIn.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, content: Buffer.from(a.content, "base64") }));
		const tooBig = attachments.find((a) => a.content.length > maxAttachmentBytes);
		if (tooBig) {
			res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: `Файл «${tooBig.fileName}» больше ${Math.round(maxAttachmentBytes / 1048576)} МБ` } });
			return;
		}

		const organization: OnecOrganization | null = b.organization ? { bin: b.organization.bin ?? null, name: b.organization.name ?? null, id: b.organization.id ?? null } : null;
		const user: ChatUser = {
			uuid: `1c:${u.baseId}:${u.userId}`, organizationUuid: u.organizationUuid, channel: "1c",
			onec: { baseId: u.baseId, userName: b.user.name, organization },
		};
		req.setTimeout(300_000);
		try {
			if (attachments.length) {
				// Распознавание PDF — минуты: ответ сразу, итог форма заберёт опросом GET /conversations/:id.
				const id = await workflow.prepare(user, b.conversationId ?? null);
				void workflow.handleInBackground(user, id, b.text, attachments);
				res.json({ success: true, data: { conversationId: id, state: "PROCESSING", text: `Читаю ${attachments.length === 1 ? "выписку" : "выписки"}… Это займёт до пары минут.` } });
				return;
			}
			let id = b.conversationId ?? null;
			if (!id) id = await workflow.prepare(user, null);
			const convId = id;
			const work: Promise<ChatReply> = b.decision
				? workflow.decide(user, convId, b.decision.accepted)
				: results.length
					? workflow.submitToolResults(user, convId, results)
					: workflow.handle(user, convId, b.text);
			// Ход дольше предела — PROCESSING, дальше опрос: соединение не держим дольше, чем ждёт форма.
			let timer: NodeJS.Timeout | undefined;
			const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), turnTimeoutMs); });
			// finally: ход, отклонённый ошибкой (400/404/409), иначе оставлял бы таймер жить до конца срока.
			const reply = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
			if (reply) {
				res.json({ success: true, data: toClient(reply) });
				return;
			}
			work.catch((e) => log.error({ err: e, conversationId: convId }, "фоновый ход 1С завершился ошибкой"));
			res.json({ success: true, data: { conversationId: convId, state: "PROCESSING", text: "Ещё работаю… ответ появится через несколько секунд." } });
		} catch (e) {
			if (e instanceof WorkflowError) {
				const status = e.code === "NOT_FOUND" ? 404 : e.code === "NOTHING_TO_CONFIRM" ? 409 : 400;
				res.status(status).json({ success: false, error: { code: e.code, message: e.message } });
				return;
			}
			log.error({ err: e, baseId: u.baseId }, "ошибка хода 1С");
			res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } });
		}
	});

	const owner = (req: Request) => {
		const u = req.onecUser!;
		return { uuid: `1c:${u.baseId}:${u.userId}`, organizationUuid: u.organizationUuid, channel: "1c" as const };
	};

	r.get("/conversations", async (req, res) => {
		if (!workflow) {
			noChat(res);
			return;
		}
		const items = await workflow.list(owner(req));
		res.json({ success: true, data: { items: items.map((c) => ({ ...c, state: clientState(c.state) })) } });
	});

	r.get("/conversations/:id", async (req, res) => {
		if (!workflow) {
			noChat(res);
			return;
		}
		const s = z.string().uuid().safeParse(req.params.id).success ? await workflow.summary(req.params.id, owner(req)) : null;
		if (!s) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Диалог не найден" } });
			return;
		}
		// Итог хода, шедшего в фоне, форма берёт отсюда: последний ответ ассистента — отдельным полем.
		const lastAssistant = [...s.messages].reverse().find((m) => m.role === "assistant");
		res.json({ success: true, data: {
			conversationId: s.id, state: clientState(s.state), text: lastAssistant?.text ?? "",
			messages: s.messages.map((m) => ({ role: m.role, text: m.text, at: m.at })),
			confirmation: s.confirmation,
			...(s.calls ? { calls: s.calls } : {}),
		} });
	});

	return r;
}
