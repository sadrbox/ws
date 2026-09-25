// Канал «чат внутри 1С» (СВ1, СВ2; контракт — docs/CONTRACT_1C_CHAT_2026-09-19.md).
//
//   GET  /v1/onec-chat/ping                 проверка связи и токена: база, организация ERP, версия сервиса, features
//   POST /v1/onec-chat/uploads              вложение отдельным запросом: сырые байты → fileId
//   POST /v1/onec-chat/turn                 ход диалога: текст | вложения | decision | toolResults
//   GET  /v1/onec-chat/conversations        диалоги пользователя 1С в этой базе
//   GET  /v1/onec-chat/conversations/:id    диалог: сообщения, состояние, карточка, ожидающие calls
//   POST /v1/onec-chat/organizations        организации базы (БИНы, которые она вправе называть)
//   GET/POST/PATCH  …/tasks                 задачи организации из ERP
//   GET/POST/PATCH/DELETE …/notes           заметки организации из ERP (правит и убирает автор)
//
// Субъект — пара «база + пользователь ИБ» (X-Base-Token + X-1C-User-Id, requireOnecUser). Имя пользователя и
// организация 1С — в теле хода: заголовки только ASCII. Инструменты выполняет форма (state TOOL_CALLS) —
// агент для этого канала не нужен.

import express, { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatWorkflow, ChatReply, ChatUser, OnecOrganization, WorkflowState } from "../chat/workflow.ts";
import { WorkflowError } from "../chat/workflow.ts";
import { requireOnecUser, type BaseTokenResolver } from "../auth/index.ts";
import type { BaseTokenStore } from "../bases/tokens.ts";
import type { BaseChatExchangeStore } from "../bases/chatExchange.ts";
import type { FileStore } from "../files/store.ts";
import type { TurnKeyStore } from "../chat/turnKeys.ts";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import { rateLimit } from "./rateLimit.ts";
import { ErpRefused, ErpUnavailable, type ErpTasks } from "../erp/tasks.ts";
import { isBin, type BaseOrganizationsStore } from "../bases/organizations.ts";

/** Версия протокола канала: форма показывает её в «Проверить связь». */
export const ONEC_CHAT_PROTOCOL = "onec-chat/1";

/** Владелец в канале 1С — пара «база + пользователь ИБ»: одна подпись у диалогов, файлов и ключей ходов. */
export const onecOwnerUuid = (baseId: string, userId: string): string => `1c:${baseId}:${userId}`;

/*
 * ВЛОЖЕНИЕ — ОДНИМ ПУТЁМ (§1, правка 22.09). Файл загружается заранее (`POST /uploads`), в ходе едет только
 * `fileId`: 20 МБ не раздуваются до 27 в base64 и не держатся в памяти дважды. Прежний путь (`content` прямо
 * в ходе) убран с ОБЕИХ сторон: расширение `buhprof_api` ещё нигде не установлено, и баз, которые слали бы
 * base64, не существует — защищать совместимость не перед кем. Ход с `content` не молчит: отказ называет
 * причину, иначе разбираться пришлось бы по раздутому телу неизвестного происхождения.
 */
/** XLSX от поставщиков и банков: содержимое читает код без ИИ (src/extract). */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const attachmentSchema = z.object({
	fileName: z.string().trim().min(1).max(200),
	mimeType: z.string().trim().max(100).default("application/pdf"),
	/** Оставлен в схеме ТОЛЬКО ради внятного отказа: разбор ходит мимо него (см. UNSUPPORTED_ATTACHMENT). */
	content: z.string().min(1).optional(),
	fileId: z.string().uuid().optional(),
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
	/*
	 * ЧИСЛО ВЛОЖЕНИЙ НЕ ЗАШИТО (задача о пределе, 22.09). Тройка была взята на глаз под «прислал выписку —
	 * разобрали»; живой сценарий — пачка выписок за месяц. Здесь предел щедрый и общий на схему, а настоящий
	 * (CHAT_ATTACHMENTS_MAX установки) проверяется отдельно, чтобы отказ мог НАЗВАТЬ число: текст zod
	 * «expected array to have <=3 items» человеку в 1С ничего не говорит.
	 */
	attachments: z.array(attachmentSchema).max(100).optional(),
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

/** Что сервис умеет сверх базового контракта: список уходит в `GET /ping` (§4). */
export type OnecChatFeature = "uploads" | "idempotency" | "token-rotation";

/** Сравнение версий расширения «1.5.0» — по числам, а не по алфавиту: «1.10.0» старше «1.9.0». */
export function versionAtLeast(version: string, min: string): boolean {
	if (!min) return true;
	const parse = (v: string) => v.split(".").map((x) => Number.parseInt(x, 10) || 0);
	const a = parse(version);
	const b = parse(min);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return true;
}

export function onecChatRouter(deps: {
	workflow: ChatWorkflow | null;
	tokens: BaseTokenResolver;
	erp: Db;
	log: Logger;
	version: string;
	/** Хранилище файлов: без него загрузка вложений отдельным запросом не объявляется и отвечает 404 (§1). */
	files?: Pick<FileStore, "save" | "getForOwner"> | null;
	/** Ключи ходов: без них `Idempotency-Key` просто не действует, ход выполняется как раньше (§2). */
	turnKeys?: Pick<TurnKeyStore, "claim" | "note" | "finish" | "release"> | null;
	/** Смена токена базы (§3). Без него токены живут как жили. */
	rotation?: Pick<BaseTokenStore, "markUsed" | "rotate" | "redeliver"> | null;
	/**
	 * Отзыв токена самой базой (контракт регистрации, «база отключается сама»). Без него кнопка «Отключить
	 * базу» в 1С стирает токен только на своей стороне, а на сервисе он остаётся годным — ровно то, от чего
	 * отзыв и заводили (аудит РС10).
	 */
	revoke?: Pick<BaseTokenStore, "revoke"> | null;
	/**
	 * Версия расширения и последний обмен — рядом с базой (С2 аудита 23.09). Без него канал работает как
	 * раньше, а панель про базу без агента по-прежнему ничего не знает.
	 */
	exchange?: Pick<BaseChatExchangeStore, "note"> | null;
	/**
	 * Версия расширения, с которой оно умеет сохранять присланный токен. Смену получает только такое:
	 * старое расширение новый токен проигнорирует, и через перекрытие база осталась бы без связи.
	 */
	rotationMinExtVersion?: string;
	/** Версия расширения, ниже которой работать отказываемся (§4). Пусто — не проверяем. */
	minExtVersion?: string;
	/** Адрес панели для ссылок на задачи (СВ1). Пусто — поле `url` не приходит вовсе. */
	panelUrl?: string;
	/** Предел изменяющих вызовов задач и заметок в минуту на пару «база + пользователь» (СВ5). */
	tasksWritePerMin?: number;
	/** Задачи и заметки организации в ERP (план PLAN_1C_TASKS_NOTES_2026-09-22). */
	tasks?: ErpTasks | null;
	baseOrgs?: BaseOrganizationsStore | null;
	maxAttachmentBytes?: number;
	/** Сколько файлов принимать в одном сообщении (CHAT_ATTACHMENTS_MAX). По умолчанию 20. */
	maxAttachments?: number;
	chatPerMin?: number;
	attachmentsPerMin?: number;
	/** Сколько держать ход до ответа PROCESSING (форма ждёт до 120 с). */
	turnTimeoutMs?: number;
}) {
	const { workflow, tokens, erp, log, version } = deps;
	const files = deps.files ?? null;
	const panelUrl = (deps.panelUrl ?? "").replace(/\/+$/, "");
	const turnKeys = deps.turnKeys ?? null;
	const maxAttachments = deps.maxAttachments ?? 20;
	const rotation = deps.rotation ?? null;
	const revoke = deps.revoke ?? null;
	const exchange = deps.exchange ?? null;
	const rotationMinExtVersion = deps.rotationMinExtVersion ?? "";
	const minExtVersion = deps.minExtVersion ?? "";
	const maxAttachmentBytes = deps.maxAttachmentBytes ?? 20 * 1048576;
	const turnTimeoutMs = deps.turnTimeoutMs ?? 90_000;
	const r = Router();
	r.use(requireOnecUser(tokens));

	// ── Кто спрашивает: версия расширения и номер запроса (§4) ────────────────────
	//
	// Оба заголовка расширение шлёт в КАЖДОМ запросе. Номер возвращаем в ответе, а оба пишем в журнал
	// рядом с базой и пользователем: разбор «у клиента что-то не сработало» сводится к поиску одного
	// значения в двух журналах — нашем и журнале регистрации 1С.
	const extOf = (req: Request) => String(req.headers["x-ext-version"] ?? "").trim().slice(0, 40);
	const requestIdOf = (req: Request) => String(req.headers["x-request-id"] ?? "").trim().slice(0, 100);
	const who = (req: Request) => ({
		baseKey: req.onecUser!.baseKey, userId: req.onecUser!.userId,
		ext: extOf(req) || null, requestId: requestIdOf(req) || null,
	});

	r.use((req, res, next) => {
		const requestId = requestIdOf(req);
		if (requestId) res.setHeader("X-Request-Id", requestId);
		const ext = extOf(req);
		/*
		 * ВЕРСИЯ И ПОСЛЕДНИЙ ОБМЕН — РЯДОМ С БАЗОЙ (С2 аудита 23.09). Пишем ДО проверки порога: база со старой
		 * сборкой — ровно тот случай, когда версию и спрашивают, а отказ 426 тоже обмен, база на связи. Не ждём
		 * ответа базы данных: показания в панели не стоят ни миллисекунды ответа человеку, а хранилище пишет не
		 * чаще раза в минуту (форма опрашивает диалог раз в секунду).
		 */
		if (exchange) {
			void exchange.note(req.onecUser!.baseId, ext).catch((e) => log.warn({ err: e, ...who(req) }, "не записан обмен с базой"));
		}
		if (minExtVersion && ext && !versionAtLeast(ext, minExtVersion)) {
			res.status(426).json({ success: false, error: { code: "EXT_TOO_OLD", message: `Расширение ${ext} устарело: нужна версия ${minExtVersion} или новее — обновите BPAPI в базе` } });
			return;
		}
		/*
		 * ПЕРВЫЙ ЗАПРОС НОВЫМ ТОКЕНОМ — подтверждение доставки (§3): с него прежний токен больше не нужен.
		 * Не ждём: ответ человеку не должен зависеть от закрытия перекрытия, а опоздание на один запрос
		 * не меняет ничего — перекрытие и так измеряется часами.
		 */
		if (rotation && req.onecUser!.firstUse) {
			void rotation.markUsed(req.onecUser!.tokenId).catch((e) => log.warn({ err: e, ...who(req) }, "не закрыто перекрытие токена базы"));
		}
		/*
		 * Ход и загрузку пишем в журнал всегда, прочее — только в подробном режиме: форма опрашивает
		 * `GET /conversations/:id` раз в секунду, пока идёт распознавание, и строка на каждый опрос
		 * утопила бы в шуме то, ради чего журнал и ведётся.
		 */
		const loud = req.method === "POST" && (req.path === "/turn" || req.path === "/uploads");
		// Метод зовём НА ОБЪЕКТЕ. `(loud ? log.info : log.debug)(…)` отрывает функцию от логгера, а pino
		// внутри читает `this` — и каждый запрос из 1С падал пятисоткой, включая ping и загрузку файла.
		const line = { ...who(req), method: req.method, path: req.path };
		if (loud) log.info(line, "запрос из 1С");
		else log.debug(line, "запрос из 1С");
		next();
	});

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
			// Что эта установка умеет сверх базового контракта (§4): форма показывает список администратору,
			// поддержка по нему сразу видит, чего ждать, а расширение — каким путём слать вложения.
			features,
			/*
			 * ПРЕДЕЛЫ УСТАНОВКИ. Форма «Подключение к BuhProf AI» показывает их администратору, и по ним же
			 * расширение понимает, сколько файлов можно прикрепить, — вместо того чтобы узнавать это отказом
			 * после того, как человек выбрал двадцать сканов.
			 */
			limits: { attachmentsPerTurn: maxAttachments, attachmentMaxBytes: maxAttachmentBytes },
		} });
	});

	const noChat = (res: Response) => res.status(503).json({ success: false, error: { code: "CHAT_DISABLED", message: "Чат в сервисе не настроен (нет модели)" } });

	const features: OnecChatFeature[] = [
		...(files ? ["uploads" as const] : []),
		...(turnKeys ? ["idempotency" as const] : []),
		...(rotation ? ["token-rotation" as const] : []),
	];

	// ── §1. Вложение отдельным запросом ──────────────────────────────────────────
	//
	// ЗАЧЕМ. PDF внутри хода едет в base64: 20 МБ превращаются в 27, и ход целиком держится в памяти и в
	// 1С, и здесь. Обрыв на девяностом проценте означает отправку файла заново — вместе со всем ходом.
	//
	// ТЕЛО — СЫРЫЕ БАЙТЫ, поэтому у маршрута свой разборщик (express.raw), а не общий express.json.
	// Имя файла кириллическое и потому едет в строке запроса закодированным: в заголовке HTTP ему нельзя.
	const uploadLimiter = rateLimit({
		max: deps.attachmentsPerMin ?? 6, windowMs: 60_000, key: pairKey,
		message: "Слишком много вложений подряд — подождите минуту",
	});
	const rawUpload = express.raw({ type: ["application/pdf", "application/octet-stream", XLSX_MIME], limit: `${Math.ceil(maxAttachmentBytes / 1048576)}mb` });
	const tooLarge = (res: Response) =>
		res.status(413).json({ success: false, error: { code: "FILE_TOO_LARGE", message: `Файл больше ${Math.round(maxAttachmentBytes / 1048576)} МБ` } });

	/**
	 * БАЗА ОТКЛЮЧАЕТСЯ САМА (контракт регистрации, часть «POST /v1/onec-chat/revoke»).
	 *
	 * Кнопка «Отключить базу» в 1С стирает токен у себя. Если не сказать об этом сервису, токен остаётся
	 * действующим: кто угодно, у кого осталась его копия, продолжит говорить от имени базы. Поэтому отзыв —
	 * односторонний и безусловный: субъект запроса и есть владелец токена, доказывать ему нечего.
	 *
	 * Повторный отзыв — не ошибка: база могла не получить ответ и повторить. Отвечаем тем же `revoked: true`.
	 */
	r.post("/revoke", async (req, res) => {
		const u = req.onecUser!;
		if (!revoke) {
			res.status(404).json({ success: false, error: { code: "UNKNOWN_ROUTE", message: "Отзыв токена базой в этой установке не включён" } });
			return;
		}
		try {
			await revoke.revoke(u.tokenId, `1С: ${u.userId}`);
		} catch (e) {
			log.error({ err: e, ...who(req) }, "токен базы не отозван по просьбе базы");
			res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Не удалось отозвать токен — повторите" } });
			return;
		}
		log.info({ ...who(req) }, "база отозвала свой токен");
		res.json({ success: true, data: { revoked: true } });
	});

	r.post("/uploads", uploadLimiter, rawUpload,
		// Предел разборщика — это отказ 413, а не «необработанная ошибка»: обработчик ошибок в цепочке
		// маршрута ловит его там же, где он возник, иначе наружу ушло бы обезличенное 500.
		(err: unknown, _req: Request, res: Response, next: import("express").NextFunction) => {
			if ((err as { type?: string } | null)?.type === "entity.too.large") return void tooLarge(res);
			next(err);
		},
		async (req: Request, res: Response) => {
			// Хранилища нет — маршрута для расширения тоже нет: оно вернётся к base64 в том же ходе.
			if (!files) {
				res.status(404).json({ success: false, error: { code: "UNKNOWN_ROUTE", message: "Загрузка вложений отдельным запросом в этой установке не включена" } });
				return;
			}
			const u = req.onecUser!;
			const body: unknown = req.body;
			if (!Buffer.isBuffer(body) || body.length === 0) {
				res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Тело запроса — сами байты файла (Content-Type: application/pdf)" } });
				return;
			}
			if (body.length > maxAttachmentBytes) return void tooLarge(res);
			let fileName = "Вложение.pdf";
			try {
				const raw = String(req.query.fileName ?? "").trim();
				if (raw) fileName = decodeURIComponent(raw).slice(0, 200);
			} catch {
				// Неверная процентная кодировка — не повод терять файл: имя подставим своё, содержимое важнее.
				log.warn(who(req), "имя загружаемого файла не разобрано");
			}
			const mimeType = String(req.headers["content-type"] ?? "application/pdf").split(";")[0]!.trim() || "application/pdf";
			const sha256 = createHash("sha256").update(body).digest("hex");
			try {
				const saved = await files.save({
					conversationId: null, organizationUuid: u.organizationUuid, userUuid: onecOwnerUuid(u.baseId, u.userId),
					fileName, mimeType, content: body,
					source: { kind: "onec-upload", baseKey: u.baseKey, userId: u.userId, sha256, ext: extOf(req) || null },
				});
				log.info({ ...who(req), fileId: saved.fileId, bytes: body.length }, "вложение загружено отдельным запросом");
				res.json({ success: true, data: { fileId: saved.fileId, bytes: body.length, sha256 } });
			} catch (e) {
				log.error({ err: e, ...who(req) }, "не сохранено вложение 1С");
				res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } });
			}
		});

	r.post("/turn", messageLimiter, resultsLimiter, attachmentLimiter, async (req, res) => {
		if (!workflow) {
			noChat(res);
			return;
		}
		const who1c = req.onecUser!;
		/*
		 * §2. КЛЮЧ ХОДА. Занимаем его ДО всякой работы: вставка — это и есть замок. Повтор с тем же ключом
		 * не начинает второй ход, а узнаёт судьбу первого: готов — получает тот же ответ дословно, ещё идёт —
		 * получает 202 и тот же диалог. Ключ рождается в 1С один раз на круг, поэтому тела не сверяем.
		 */
		const key = String(req.headers["idempotency-key"] ?? "").trim().slice(0, 200);
		const keyPair = key && turnKeys ? { baseId: who1c.baseId, userId: who1c.userId, key } : null;
		if (keyPair && turnKeys) {
			const state = await turnKeys.claim(keyPair);
			if (state.kind === "done") {
				log.info({ ...who(req), key }, "повтор хода: отдан сохранённый ответ");
				res.status(state.status).json(state.response);
				return;
			}
			if (state.kind === "running") {
				log.info({ ...who(req), key }, "повтор хода: прежний ещё выполняется");
				res.status(202).json({ success: true, data: { conversationId: state.conversationId, state: "PROCESSING", text: "Ход уже выполняется — ответ появится в этом же диалоге." } });
				return;
			}
			/*
			 * Записываем ЛЮБОЙ исход, кроме своей же поломки: 400 и 404 — это ответ, и повтор обязан получить
			 * тот же; 500 — не ответ, а неудача, и ключ освобождается, чтобы повтор имел смысл.
			 */
			const send = res.json.bind(res);
			res.json = ((body: unknown) => {
				const status = res.statusCode || 200;
				const done = status >= 500 ? turnKeys.release(keyPair) : turnKeys.finish(keyPair, status, body);
				void done.catch((e) => log.warn({ err: e, ...who(req), key }, "не записан итог хода по ключу"));
				return send(body as never);
			}) as typeof res.json;
		}
		/*
		 * §3. ТИХАЯ СМЕНА ТОКЕНА. Решение принимаем ДО работы, а отдаём — вместе с успешным ответом: новый
		 * токен едет полем `baseToken`, расширение сохраняет его само. Смену получает только расширение,
		 * которое умеет её принять: старое новый токен проигнорирует и через перекрытие осталось бы без связи.
		 * Ход, сорвавшийся после смены, ничего не теряет: неподтверждённый токен отдаётся снова на следующем.
		 */
		let nextToken: string | null = null;
		if (rotation && (who1c.pending || who1c.rotateDue) && versionAtLeast(extOf(req), rotationMinExtVersion)) {
			try {
				nextToken = who1c.pending ? await rotation.redeliver(who1c.tokenId) : await rotation.rotate(who1c.tokenId, "rotation");
				if (nextToken) log.info({ ...who(req), again: who1c.pending }, "базе отправлен новый токен");
			} catch (e) {
				log.warn({ err: e, ...who(req) }, "не удалась смена токена базы");
			}
		}
		if (nextToken) {
			const token = nextToken;
			const send = res.json.bind(res);
			res.json = ((body: unknown) => {
				const b = body as { success?: boolean; data?: Record<string, unknown> } | null;
				if (b?.success && b.data && typeof b.data === "object") b.data.baseToken = token;
				return send(body as never);
			}) as typeof res.json;
		}
		/*
		 * Диалог запоминается в ключе, как только стал известен: повтор, пришедший ПОКА ход идёт, назовёт в
		 * ответе тот же диалог — форма 1С откроет его и дождётся итога там, а не заведёт второй.
		 */
		const noteKey = (conversationId: string) => {
			if (keyPair && turnKeys) void turnKeys.note(keyPair, conversationId).catch((e) => log.warn({ err: e, ...who(req) }, "не записан диалог ключа хода"));
		};
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
		// Предел числа файлов называет число: расширение показывает этот текст пользователю как есть.
		if (attachmentsIn.length > maxAttachments) {
			res.status(400).json({ success: false, error: { code: "TOO_MANY_ATTACHMENTS", message: `К одному сообщению — не больше ${maxAttachments} файлов, прислано ${attachmentsIn.length}` } });
			return;
		}
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
		/*
		 * Вложение приходит ОДНИМ путём (§1): идентификатором файла, загруженного заранее. Чужой файл по
		 * угаданному идентификатору не открывается — владелец тот же, что у диалогов: пара «база + пользователь».
		 * base64 прямо в ходе — сборка расширения старше правки 22.09: отказываем и называем, что делать, вместо
		 * того чтобы принять многомегабайтное тело, которое больше никто не шлёт.
		 */
		const attachments: { fileName: string; mimeType: string; content: Buffer }[] = [];
		for (const a of attachmentsIn) {
			if (a.content) {
				res.status(415).json({ success: false, error: { code: "UNSUPPORTED_ATTACHMENT", message: `Вложение «${a.fileName}» пришло в теле хода: загрузите файл запросом POST /v1/onec-chat/uploads и пришлите fileId — обновите BuhProf AI` } });
				return;
			}
			if (!a.fileId) {
				res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Вложение «${a.fileName}» без fileId: сначала загрузите файл запросом POST /v1/onec-chat/uploads` } });
				return;
			}
			const stored = files ? await files.getForOwner(a.fileId, u.organizationUuid, onecOwnerUuid(u.baseId, u.userId)) : null;
			if (!stored) {
				res.status(400).json({ success: false, error: { code: "UNKNOWN_FILE", message: "Загруженный файл не найден или устарел — отправьте его заново" } });
				return;
			}
			attachments.push({ fileName: a.fileName || stored.fileName, mimeType: a.mimeType || stored.mimeType, content: stored.content });
		}
		const tooBig = attachments.find((a) => a.content.length > maxAttachmentBytes);
		if (tooBig) {
			res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: `Файл «${tooBig.fileName}» больше ${Math.round(maxAttachmentBytes / 1048576)} МБ` } });
			return;
		}

		const organization: OnecOrganization | null = b.organization ? { bin: b.organization.bin ?? null, name: b.organization.name ?? null, id: b.organization.id ?? null } : null;
		const user: ChatUser = {
			uuid: onecOwnerUuid(u.baseId, u.userId), organizationUuid: u.organizationUuid, channel: "1c",
			onec: { baseId: u.baseId, userName: b.user.name, organization },
		};
		req.setTimeout(300_000);
		try {
			if (attachments.length) {
				// Распознавание PDF — минуты: ответ сразу, итог форма заберёт опросом GET /conversations/:id.
				const id = await workflow.prepare(user, b.conversationId ?? null);
				noteKey(id);
				void workflow.handleInBackground(user, id, b.text, attachments);
				res.json({ success: true, data: { conversationId: id, state: "PROCESSING", text: `Читаю ${attachments.length === 1 ? "выписку" : "выписки"}… Это займёт до пары минут.` } });
				return;
			}
			let id = b.conversationId ?? null;
			if (!id) id = await workflow.prepare(user, null);
			const convId = id;
			noteKey(convId);
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
		return { uuid: onecOwnerUuid(u.baseId, u.userId), organizationUuid: u.organizationUuid, channel: "1c" as const };
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

	// ── Задачи и заметки организации (ERP) ───────────────────────────────────────
	//
	// Хранилище одно — ERP: список в 1С и список в панели должны быть одним списком. Сервис здесь
	// посредник, и его единственная собственная обязанность — не дать базе назвать чужой БИН.
	const { tasks, baseOrgs } = deps;

	/*
	 * СВ5. ИЗМЕНЯЮЩИЕ ВЫЗОВЫ — ОТДЕЛЬНЫМ, БОЛЕЕ УЗКИМ ЛИМИТОМ. Общий лимит канала считает ходы чата:
	 * их тридцать в минуту, потому что за каждым стоит человек, пишущий текст. Создание задачи или
	 * заметки идёт из формы списком и одним нажатием, а каждая запись доходит до ERP и до исполнителя
	 * уведомлением — цикл в расширении, сорвавшийся в повтор, наплодил бы их сотнями.
	 */
	const tasksWriteLimiter = rateLimit({
		max: deps.tasksWritePerMin ?? 20, windowMs: 60_000, key: pairKey,
		message: "Слишком много изменений задач подряд — подождите минуту",
	});

	const noTasks = (res: import("express").Response) =>
		res.status(503).json({ success: false, error: { code: "TASKS_DISABLED", message: "Задачи и заметки недоступны: служебный канал ERP не настроен" } });

	/** БИН хода: он должен принадлежать этой базе — иначе по чужому БИН читались бы чужие задачи. */
	async function binOf(req: Request, res: import("express").Response): Promise<string | null> {
		const raw = String((req.method === "GET" ? req.query.bin : (req.body as { bin?: unknown } | undefined)?.bin) ?? "").trim();
		if (!isBin(raw)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "bin: ожидается БИН организации, 12 цифр" } });
			return null;
		}
		if (baseOrgs && !(await baseOrgs.has(req.onecUser!.baseId, raw))) {
			res.status(403).json({ success: false, error: { code: "ORG_NOT_IN_BASE", message: "Эта организация не зарегистрирована за базой — откройте «Подключение к BuhProf AI» и обновите список организаций" } });
			return null;
		}
		return raw;
	}

	/** Имя пользователя 1С: по нему ERP находит автора, а нет такого — заводит (как у событий 1С). */
	function actorOf(req: Request, bin: string): { bin: string; user: { name: string } } | null {
		const name = String((req.body as { user?: { name?: unknown } } | undefined)?.user?.name ?? "").trim();
		return name ? { bin, user: { name } } : null;
	}

	const needActor = (res: import("express").Response) =>
		res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "user.name: нужно имя пользователя 1С" } });

	/** Отказ ERP показываем её словами, сбой связи — своими: причины разные и лечатся по-разному. */
	function erpFail(e: unknown, res: import("express").Response, where: string): void {
		if (e instanceof ErpRefused) {
			res.status(e.status === 404 ? 404 : e.status === 400 ? 400 : e.status === 503 ? 503 : 409).json({ success: false, error: { code: "ERP_REFUSED", message: e.message } });
			return;
		}
		if (e instanceof ErpUnavailable) {
			res.status(503).json({ success: false, error: { code: "ERP_UNAVAILABLE", message: e.message } });
			return;
		}
		log.error({ err: e }, `ошибка ${where}`);
		res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } });
	}

	// Список организаций базы: форма шлёт его при открытии — организацию могли завести уже после
	// регистрации базы. Объединение, а не замена: список пользователя сужен его правами.
	r.post("/organizations", async (req, res) => {
		const parsed = z.object({
			organizations: z.array(z.object({
				bin: z.string().trim().max(20).nullable().optional(),
				name: z.string().trim().max(300).nullable().optional(),
				id: z.string().trim().max(100).nullable().optional(),
			})).max(500),
		}).safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "organizations: список организаций базы" } });
			return;
		}
		if (!baseOrgs) {
			res.json({ success: true, data: { remembered: 0 } });
			return;
		}
		/*
		 * СВ4. СПИСОК ПРИСЫЛАЮТ ПРИ КАЖДОМ ОТКРЫТИИ ЧАТА, а меняется он в год раз. Считаем отпечаток
		 * присланного списка и возвращаем его заголовком `ETag`: расширение кладёт его в `If-None-Match`
		 * следующего открытия, и совпавший отпечаток означает «то же самое» — в базу не пишем.
		 *
		 * Отпечаток — от БИНов, имён и ссылок, в устойчивом порядке: перестановка строк в выборке 1С
		 * не должна выглядеть изменением. Сравнение дешёвое и ни от чего не зависит: старое расширение
		 * заголовка не шлёт и работает как прежде.
		 */
		const list = parsed.data.organizations
			.map((o) => `${String(o.bin ?? "").trim()}|${String(o.name ?? "").trim()}|${String(o.id ?? "").trim()}`)
			.sort();
		const etag = `"${createHash("sha256").update(list.join("\n")).digest("hex").slice(0, 32)}"`;
		res.setHeader("ETag", etag);
		if (String(req.headers["if-none-match"] ?? "").trim() === etag) {
			res.json({ success: true, data: { remembered: 0, unchanged: true } });
			return;
		}
		const remembered = await baseOrgs.remember(req.onecUser!.baseId, parsed.data.organizations);
		res.json({ success: true, data: { remembered, unchanged: false } });
	});

	/*
	 * ССЫЛКА НА ЗАДАЧУ (СВ1). Расширение открывает её в браузере, поэтому адрес должен быть тот, который
	 * панель действительно понимает. Маршрутов вида `/todos/<uuid>` в панели нет: она открывает записи
	 * коротким рецептом в строке запроса (`?open=f~<endpoint>~<uuid>`, frontend/src/utils/paneLink.ts).
	 * Адрес панели не задан — поля `url` просто нет: неоткрывающаяся ссылка хуже её отсутствия.
	 */
	const taskUrl = (uuid: string): string | undefined =>
		panelUrl ? `${panelUrl}/?open=f~todos~${encodeURIComponent(uuid)}` : undefined;
	const withUrl = <T extends { uuid: string }>(t: T): T & { url?: string } => {
		const url = taskUrl(t.uuid);
		return url ? { ...t, url } : t;
	};

	/**
	 * СТАТУСЫ ЗАДАЧ (СВ2). Справочник ведётся в ERP, и 1С показывала код («in_progress») вместо
	 * человеческого названия. Здесь сервис — посредник: ни своего списка, ни перевода кодов у него нет
	 * и быть не должно, иначе он разойдётся с панелью при первом же изменении справочника.
	 */
	r.get("/task-statuses", async (_req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		try {
			res.json({ success: true, data: { items: await tasks.statuses() } });
		} catch (e) {
			erpFail(e, res, "чтения статусов задач");
		}
	});

	r.get("/tasks", async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		try {
			const state = req.query.state === "all" ? "all" : "open";
			const items = await tasks.listTasks(bin, { state, limit: Number(req.query.limit) || 50 });
			res.json({ success: true, data: { items: items.map(withUrl) } });
		} catch (e) {
			erpFail(e, res, "чтения задач");
		}
	});

	r.post("/tasks", tasksWriteLimiter, async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		const actor = actorOf(req, bin);
		if (!actor) return void needActor(res);
		const b = req.body as {
			name?: string; description?: string; deadline?: string | null; executorName?: string | null;
			sourceType?: string | null; sourceUuid?: string | null; sourceLabel?: string | null; kind?: unknown;
		};
		try {
			const item = await tasks.createTask(actor, {
				name: b.name, description: b.description, deadline: b.deadline ?? null, executorName: b.executorName ?? null,
				// Происхождение — отдельным полем от ссылки на объект: задача из 1С может ссылаться
				// на созданный в 1С документ, и метку «пришла из чата» это стирать не должно.
				originLabel: `Чат в 1С — ${req.onecUser!.baseName}`,
				sourceType: b.sourceType ?? null, sourceUuid: b.sourceUuid ?? null, sourceLabel: b.sourceLabel ?? null,
				// Вид задачи (E17, СК1.1): только известные значения; прочее — не передаём, ERP поставит `task`.
				...(b.kind === "client_request" || b.kind === "task" ? { kind: b.kind } : {}),
			});
			res.status(201).json({ success: true, data: { item: withUrl(item) } });
		} catch (e) {
			erpFail(e, res, "создания задачи");
		}
	});

	r.patch("/tasks/:uuid", tasksWriteLimiter, async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		const actor = actorOf(req, bin);
		if (!actor) return void needActor(res);
		const b = req.body as { name?: string; description?: string; deadline?: string | null; status?: string; close?: boolean; result?: unknown };
		try {
			const item = await tasks.updateTask(actor, String(req.params.uuid), {
				name: b.name, description: b.description, deadline: b.deadline, status: b.status, close: b.close,
				/*
				 * ЧТО СДЕЛАНО (E17, СК1.2). С 25.09 ERP не закрывает задачу без результата, а этот маршрут пропускал
				 * только перечисленные поля — и кнопка «Закрыть» в форме 1С отказывала бы всегда, даже с заполненным
				 * результатом. Пустое не передаём: «нет результата» решает ERP, а не пустая строка.
				 */
				...(typeof b.result === "string" && b.result.trim() ? { result: b.result.trim() } : {}),
			});
			res.json({ success: true, data: { item: withUrl(item) } });
		} catch (e) {
			erpFail(e, res, "изменения задачи");
		}
	});

	r.get("/notes", async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		try {
			const items = await tasks.listNotes(bin, { limit: Number(req.query.limit) || 50 });
			res.json({ success: true, data: { items } });
		} catch (e) {
			erpFail(e, res, "чтения заметок");
		}
	});

	r.post("/notes", tasksWriteLimiter, async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		const actor = actorOf(req, bin);
		if (!actor) return void needActor(res);
		const body = String((req.body as { body?: unknown } | undefined)?.body ?? "").trim();
		if (!body) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "body: текст заметки" } });
			return;
		}
		try {
			const item = await tasks.addNote(actor, body);
			res.status(201).json({ success: true, data: { item } });
		} catch (e) {
			erpFail(e, res, "создания заметки");
		}
	});

	/*
	 * ПРАВКА И УБОРКА ЗАМЕТКИ (СВ3). В панели это разрешено автору, в 1С не было вовсе: написал с
	 * опечаткой — и она навсегда. Право решает ERP (автор, организация), сервис лишь не даёт назвать
	 * чужой БИН. Уборка — пометка, а не стирание: заметка могла быть основанием задачи.
	 */
	r.patch("/notes/:uuid", tasksWriteLimiter, async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		const actor = actorOf(req, bin);
		if (!actor) return void needActor(res);
		const body = String((req.body as { body?: unknown } | undefined)?.body ?? "").trim();
		if (!body) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "body: текст заметки" } });
			return;
		}
		try {
			res.json({ success: true, data: { item: await tasks.updateNote(actor, String(req.params.uuid), body) } });
		} catch (e) {
			erpFail(e, res, "изменения заметки");
		}
	});

	r.delete("/notes/:uuid", tasksWriteLimiter, async (req, res) => {
		if (!tasks?.enabled) return void noTasks(res);
		const bin = await binOf(req, res);
		if (!bin) return;
		const actor = actorOf(req, bin);
		if (!actor) return void needActor(res);
		try {
			res.json({ success: true, data: { item: await tasks.deleteNote(actor, String(req.params.uuid)) } });
		} catch (e) {
			erpFail(e, res, "уборки заметки");
		}
	});

	return r;
}
