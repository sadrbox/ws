// Клиент служебного канала ERP (/bpai): задачи и заметки организации, а с E17 — ещё и результаты ночных
// проверок учёта в базах 1С (sendCheckResults).
//
// ПОЧЕМУ HTTP, А НЕ SQL. Сервис читает базу ERP напрямую (организации, пользователи), но здесь
// этого мало: у задачи есть правила ERP — резолв автора и организации, статусы-справочник,
// уведомление исполнителя, журнал действий. Повторять их запросами значило бы разойтись с
// панелью при первом же изменении. Поэтому — маршруты ERP, ключом X-Api-Key.
//
// ЧУЖИЕ ОТКАЗЫ НЕ ПЕРЕСКАЗЫВАЕМ. ERP отвечает `{success, message}`; текст показываем как есть —
// он написан для человека. Сетевой сбой отделён от отказа: «ERP не ответила» и «ERP отказала» —
// разные причины, и лечатся они по-разному.

import type { Logger } from "../logger.ts";

export type ErpTask = {
	uuid: string;
	id: number;
	name: string | null;
	description: string | null;
	status: string;
	deadline: string | null;
	createdAt: string;
	updatedAt: string;
	curatorName: string | null;
	executorName: string | null;
	sourceLabel: string | null;
	/** Ссылка на объект-источник, если задачу связали с документом (СВ7). */
	sourceType?: string | null;
	sourceUuid?: string | null;
	/** Происхождение задачи и его подпись: «из чата в 1С — Dev_01». Отдельно от ссылки. */
	origin?: string | null;
	originLabel?: string | null;
	/*
	 * СТАНДАРТ КАЧЕСТВА (E17, СК1). Поля приходят от ERP, начиная с доработки 25.09; ERP старше их не шлёт,
	 * поэтому все необязательные, и «поля нет» значит «ERP не знает», а не «ноль».
	 */
	/** Вид задачи: `client_request` — обращение клиента (у него свой срок реакции), `task` — обычная. */
	kind?: string | null;
	/** Что сделано — конкретный результат (СК1.2): без него ERP задачу не закроет. */
	result?: string | null;
	/** Сколько раз клиент напоминал о задаче (СК1.3): второе и следующее — кандидат в нарушение п. 2. */
	reminderCount?: number | null;
	/** Оценка клиента 1–5 (СК7.2); null — не оценивали. */
	clientRating?: number | null;
};

/** Вид задачи при создании: обращение клиента или обычная задача (по умолчанию ERP ставит `task`). */
export type ErpTaskKind = "client_request" | "task";

/**
 * РЕЗУЛЬТАТЫ НОЧНЫХ ПРОВЕРОК УЧЁТА ОДНОЙ ОРГАНИЗАЦИИ (E17, СК2.2) — тело `POST /bpai/checks/results`.
 *
 * Форму задаёт ERP (она превращает находки в задачи и закрывает их, когда находка исчезла), сервис лишь
 * собирает то, что ответила 1С: каталог базы, прогон каждой проверки и снимки. `request` — ровно тот payload,
 * что ушёл в 1С: по нему ERP видит период и предел, с которыми получена находка. `data` — ответ 1С как есть.
 */
export type ErpCheckOutcome =
	| { ok: true; data: unknown }
	| { ok: false; error: { code: string; message: string } };

export type ErpCheckRun = { check: string; scope: "organization" | "base"; request: Record<string, unknown> } & ErpCheckOutcome;
export type ErpSnapshotRun = { snapshot: string; request: Record<string, unknown> } & ErpCheckOutcome;

export type ErpCheckResults = {
	/** БИН организации ERP, которой адресованы результаты. */
	bin: string;
	baseKey: string;
	agentId: string;
	startedAt: string;
	finishedAt: string;
	/**
	 * Каталог базы (LIST_ACCOUNTING_CHECKS) — как его вернула 1С: версии проверок, доступность, параметры.
	 * `null` — «база не проверена» (п. 21 реестра E17): каталог не получен или сборка агента не умеет проверки.
	 * Тогда в `runs` ровно одна строка `_catalog` с `ok: false` и причиной, а `snapshots` пуст.
	 */
	catalog: { apiVersion: string | null; checks: unknown[]; snapshots: unknown[] } | null;
	runs: ErpCheckRun[];
	snapshots: ErpSnapshotRun[];
};

/**
 * Сколько ждать ERP с результатами проверок. Обычные вызовы канала — строка задачи, им хватает
 * ERP_API_TIMEOUT_MS (15 с); здесь ERP разбирает до тысячи находок на проверку и заводит по ним задачи, и
 * оборвать её на середине значит потерять ночной прогон организации.
 */
const CHECK_RESULTS_TIMEOUT_MS = 120_000;

export type ErpNote = {
	uuid: string;
	id: number;
	body: string;
	authorName: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ErpTaskStatus = { code: string; name: string; isFinal: boolean; sortOrder: number };

/** Кто пишет: имя пользователя 1С. ERP найдёт его или заведёт — как у событий `/pipe`. */
export type ErpActor = { bin: string; user: { name: string } };

export class ErpUnavailable extends Error {}
export class ErpRefused extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export class ErpTasks {
	private readonly base: string;
	private readonly key: string;
	private readonly timeoutMs: number;
	private readonly log: Logger;

	constructor(deps: { url: string; key: string; timeoutMs: number; log: Logger }) {
		this.base = deps.url.replace(/\/+$/, "");
		this.key = deps.key;
		this.timeoutMs = deps.timeoutMs;
		this.log = deps.log;
	}

	/** Настроен ли канал: без ключа задачи и заметки просто недоступны. */
	get enabled(): boolean {
		return this.key.length > 0;
	}

	async listTasks(bin: string, opts: { state?: "open" | "all"; limit?: number } = {}): Promise<ErpTask[]> {
		const q = new URLSearchParams({ bin, state: opts.state ?? "open", ...(opts.limit ? { limit: String(opts.limit) } : {}) });
		return (await this.call<{ items: ErpTask[] }>("GET", `/bpai/tasks?${q}`)).items;
	}

	async createTask(actor: ErpActor, task: {
		name?: string; description?: string; deadline?: string | null; executorName?: string | null;
		/** Подпись происхождения: «Чат в 1С — Dev_01». Метку ставит сама ERP. */
		originLabel?: string | null;
		/** Ссылка на объект 1С: пара «тип + uuid» целиком или ничего (СВ7). */
		sourceType?: string | null; sourceUuid?: string | null; sourceLabel?: string | null;
		/** Вид задачи (СК1.1); не задан — ERP ставит `task`. */
		kind?: ErpTaskKind;
	}): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("POST", "/bpai/tasks", { ...actor, ...task })).item;
	}

	/**
	 * Правка и закрытие. `result` — что сделано (СК1.2): закрытие (`close` или завершающий статус) без результата —
	 * уже записанного или присланного здесь — ERP отвергает с 400 «Нужен результат: что сделано».
	 */
	async updateTask(actor: ErpActor, uuid: string, patch: { name?: string; description?: string; deadline?: string | null; status?: string; close?: boolean; result?: string }): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("PATCH", `/bpai/tasks/${encodeURIComponent(uuid)}`, { ...actor, ...patch })).item;
	}

	/**
	 * НАПОМИНАНИЕ КЛИЕНТА (СК1.3). Не правка задачи, а отдельное событие: ERP считает напоминания (`reminderCount`),
	 * и второе по той же задаче — кандидат в нарушение п. 2 стандарта («клиент не должен контролировать бухгалтера»).
	 */
	async remindTask(actor: ErpActor, uuid: string, note?: string): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("POST", `/bpai/tasks/${encodeURIComponent(uuid)}/remind`, {
			...actor, ...(note ? { note } : {}),
		})).item;
	}

	/** Оценка выполненной задачи клиентом: 1–5 и, если сказал, комментарий (СК7.2). */
	async rateTask(actor: ErpActor, uuid: string, rating: number, comment?: string): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("POST", `/bpai/tasks/${encodeURIComponent(uuid)}/rate`, {
			...actor, rating, ...(comment ? { comment } : {}),
		})).item;
	}

	/**
	 * Результаты ночных проверок учёта одной организации (E17, СК2.2). Отвечает ERP счётчиками — что она сделала с
	 * находками; сервис их только пишет в журнал. Канал не настроен — отказ своими словами: «задачи недоступны»
	 * здесь сбивало бы с толку.
	 */
	async sendCheckResults(body: ErpCheckResults): Promise<Record<string, unknown>> {
		if (!this.enabled) throw new ErpRefused(503, "Результаты проверок учёта некуда отправить: служебный канал ERP не настроен (ERP_API_KEY)");
		const r = await this.call<{ data?: Record<string, unknown> }>("POST", "/bpai/checks/results", body, Math.max(this.timeoutMs, CHECK_RESULTS_TIMEOUT_MS));
		return r.data ?? {};
	}

	async listNotes(bin: string, opts: { limit?: number } = {}): Promise<ErpNote[]> {
		const q = new URLSearchParams({ bin, ...(opts.limit ? { limit: String(opts.limit) } : {}) });
		return (await this.call<{ items: ErpNote[] }>("GET", `/bpai/notes?${q}`)).items;
	}

	async addNote(actor: ErpActor, body: string): Promise<ErpNote> {
		return (await this.call<{ item: ErpNote }>("POST", "/bpai/notes", { ...actor, body })).item;
	}

	/**
	 * Правка и уборка заметки (СВ3). Право — авторство: ERP откажет чужому (403), а чужую
	 * организацию назовёт «не найдено» (404), чтобы по коду ответа нельзя было перебирать записи.
	 * Тело у DELETE непривычно, но обязательно: в нём БИН и имя автора — иначе субъекта нет.
	 */
	async updateNote(actor: ErpActor, uuid: string, body: string): Promise<ErpNote> {
		return (await this.call<{ item: ErpNote }>("PATCH", `/bpai/notes/${encodeURIComponent(uuid)}`, { ...actor, body })).item;
	}

	async deleteNote(actor: ErpActor, uuid: string): Promise<{ uuid: string }> {
		return (await this.call<{ item: { uuid: string } }>("DELETE", `/bpai/notes/${encodeURIComponent(uuid)}`, { ...actor })).item;
	}

	async statuses(): Promise<ErpTaskStatus[]> {
		return (await this.call<{ items: ErpTaskStatus[] }>("GET", "/bpai/task-statuses")).items;
	}

	private async call<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
		if (!this.enabled) throw new ErpRefused(503, "Задачи и заметки недоступны: служебный канал ERP не настроен");
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		let res: Response;
		try {
			res = await fetch(`${this.base}${path}`, {
				method,
				headers: { "X-Api-Key": this.key, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: ctrl.signal,
			});
		} catch (e) {
			this.log.warn({ err: e instanceof Error ? e.message : String(e), path }, "ERP не ответила");
			throw new ErpUnavailable("ERP не отвечает — задачи и заметки сейчас недоступны");
		} finally {
			clearTimeout(timer);
		}

		const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
		if (!res.ok || !data?.success) {
			const message = data?.message ?? `ERP отказала (HTTP ${res.status})`;
			// Ключ и путь — в журнал, наружу только текст ERP: он написан для человека.
			this.log.warn({ status: res.status, path }, "ERP отказала");
			throw new ErpRefused(res.status, message);
		}
		return data as T;
	}
}
