// Клиент служебного канала ERP (/bpai): задачи и заметки организации.
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
};

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

	async createTask(actor: ErpActor, task: { name?: string; description?: string; deadline?: string | null; executorName?: string | null; sourceLabel?: string | null }): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("POST", "/bpai/tasks", { ...actor, ...task })).item;
	}

	async updateTask(actor: ErpActor, uuid: string, patch: { name?: string; description?: string; deadline?: string | null; status?: string; close?: boolean }): Promise<ErpTask> {
		return (await this.call<{ item: ErpTask }>("PATCH", `/bpai/tasks/${encodeURIComponent(uuid)}`, { ...actor, ...patch })).item;
	}

	async listNotes(bin: string, opts: { limit?: number } = {}): Promise<ErpNote[]> {
		const q = new URLSearchParams({ bin, ...(opts.limit ? { limit: String(opts.limit) } : {}) });
		return (await this.call<{ items: ErpNote[] }>("GET", `/bpai/notes?${q}`)).items;
	}

	async addNote(actor: ErpActor, body: string): Promise<ErpNote> {
		return (await this.call<{ item: ErpNote }>("POST", "/bpai/notes", { ...actor, body })).item;
	}

	async statuses(): Promise<ErpTaskStatus[]> {
		return (await this.call<{ items: ErpTaskStatus[] }>("GET", "/bpai/task-statuses")).items;
	}

	private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		if (!this.enabled) throw new ErpRefused(503, "Задачи и заметки недоступны: служебный канал ERP не настроен");
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
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
