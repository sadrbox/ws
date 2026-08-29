// Очередь команд агентам.
//
// Хранится в PostgreSQL — команда переживает перезапуск сервиса и отсутствие агента.
// Long-poll агента не крутит базу в цикле: ожидающие запросы висят на in-process
// «звонке» (EventEmitter по agentId) и просыпаются, когда что-то кладут в очередь. При
// нескольких инстансах сервиса звонок сработает только в том, куда попал enqueue, —
// остальные заметят команду на следующем цикле poll (максимум POLL_MAX_WAIT секунд).
// Для MVP с одним инстансом это ровно ноль задержки.
//
// ИДЕМПОТЕНТНОСТЬ. requestId уходит в 1С как есть; повтор команды с тем же requestId —
// не дубль документа, а тот же результат. Поэтому очередь не пытается дедуплицировать
// команды по содержимому: это уже сделано там, где создаётся документ.

import { EventEmitter } from "node:events";
import type { Db } from "../db/pool.ts";

export type CommandState = "queued" | "dispatched" | "done" | "failed" | "expired";

export type EnqueueInput = {
	agentId: string;
	organizationUuid: string;
	type: string;
	payload: Record<string, unknown>;
	requestId?: string | null;
	userUuid?: string | null;
	conversationId?: string | null;
	ttlSeconds?: number;
};

export type CommandRow = {
	id: string;
	agent_id: string;
	organization_uuid: string;
	request_id: string | null;
	type: string;
	payload: Record<string, unknown>;
	state: CommandState;
	user_uuid: string | null;
	conversation_id: string | null;
	result_status: string | null;
	result: unknown;
	error: { code: string; message: string; details?: unknown } | null;
	onec_http_status: number | null;
	created_at: Date;
	dispatched_at: Date | null;
	finished_at: Date | null;
	expires_at: Date;
};

/** Команда в формате протокола агента. */
export type WireCommand = { id: string; requestId?: string; type: string; payload: Record<string, unknown> };

export type WireResult = {
	commandId: string;
	agentId: string;
	status: "SUCCESS" | "ERROR";
	result?: unknown;
	error?: { code: string; message: string; details?: unknown };
	startedAt?: string;
	finishedAt?: string;
	onecHttpStatus?: number;
};

export class CommandQueue {
	private readonly bell = new EventEmitter();
	private readonly db: Db;
	private closed = false;

	constructor(db: Db) {
		this.db = db;
		this.bell.setMaxListeners(1000);
	}

	/**
	 * Остановка: все висящие long-poll'ы просыпаются и уходят пустыми, к базе очередь больше
	 * не обращается. Вызывать ДО закрытия пула — иначе агент, ждавший команд, получит ошибку
	 * «pool after end» вместо пустого ответа.
	 */
	close(): void {
		this.closed = true;
		for (const name of this.bell.eventNames()) this.bell.emit(name);
	}

	async enqueue(input: EnqueueInput): Promise<CommandRow> {
		const id = "cmd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
		const ttl = Math.max(30, input.ttlSeconds ?? 3600);
		const r = await this.db.query<CommandRow>(
			`INSERT INTO commands (id, agent_id, organization_uuid, request_id, type, payload, user_uuid, conversation_id, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now() + ($9 || ' seconds')::interval)
			 RETURNING *`,
			[id, input.agentId, input.organizationUuid, input.requestId ?? null, input.type,
				JSON.stringify(input.payload ?? {}), input.userUuid ?? null, input.conversationId ?? null, String(ttl)],
		);
		this.bell.emit(input.agentId);
		return r.rows[0];
	}

	/**
	 * Выдаёт агенту все ожидающие команды, при пустой очереди ждёт до waitSecs.
	 * Выдача атомарна: UPDATE ... WHERE state='queued' — два инстанса не отдадут одну команду дважды.
	 */
	async take(agentId: string, waitSecs: number): Promise<WireCommand[]> {
		const deadline = Date.now() + waitSecs * 1000;
		for (;;) {
			if (this.closed) return [];
			const batch = await this.dispatchQueued(agentId);
			if (batch.length) return batch;
			const remaining = deadline - Date.now();
			if (remaining <= 0 || this.closed) return [];
			await this.waitForBell(agentId, Math.min(remaining, 5000));
		}
	}

	private async dispatchQueued(agentId: string): Promise<WireCommand[]> {
		// Просроченные — в expired, чтобы агент не выполнял то, чего уже никто не ждёт.
		await this.db.query(
			`UPDATE commands SET state = 'expired', finished_at = now()
			  WHERE agent_id = $1 AND state = 'queued' AND expires_at < now()`,
			[agentId],
		);
		const r = await this.db.query<CommandRow>(
			`UPDATE commands SET state = 'dispatched', dispatched_at = now()
			  WHERE id IN (SELECT id FROM commands WHERE agent_id = $1 AND state = 'queued' ORDER BY created_at LIMIT 20)
			  RETURNING *`,
			[agentId],
		);
		return r.rows.map((c) => ({
			id: c.id,
			...(c.request_id ? { requestId: c.request_id } : {}),
			type: c.type,
			payload: c.payload ?? {},
		}));
	}

	private waitForBell(agentId: string, ms: number): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.bell.off(agentId, done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			this.bell.once(agentId, done);
		});
	}

	/** Результат от агента. Повторная доставка того же результата (spool) — не ошибка. */
	async complete(agentId: string, res: WireResult): Promise<CommandRow | null> {
		const ok = res.status === "SUCCESS";
		const r = await this.db.query<CommandRow>(
			`UPDATE commands
			    SET state = $3, result_status = $4, result = $5::jsonb, error = $6::jsonb,
			        onec_http_status = $7, finished_at = COALESCE(finished_at, now())
			  WHERE id = $1 AND agent_id = $2
			  RETURNING *`,
			[res.commandId, agentId, ok ? "done" : "failed", res.status,
				res.result === undefined ? null : JSON.stringify(res.result),
				res.error === undefined ? null : JSON.stringify(res.error),
				res.onecHttpStatus ?? null],
		);
		const row = r.rows[0] ?? null;
		if (row) this.bell.emit("result:" + row.id);
		return row;
	}

	async get(id: string): Promise<CommandRow | null> {
		const r = await this.db.query<CommandRow>(`SELECT * FROM commands WHERE id = $1`, [id]);
		return r.rows[0] ?? null;
	}

	/** Ждёт завершения команды до timeoutMs — для синхронных вызовов из диалога. */
	async waitResult(id: string, timeoutMs: number): Promise<CommandRow | null> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const row = await this.get(id);
			if (!row) return null;
			if (row.state === "done" || row.state === "failed" || row.state === "expired") return row;
			const remaining = deadline - Date.now();
			if (remaining <= 0) return row;
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(t);
					this.bell.off("result:" + id, done);
					resolve();
				};
				const t = setTimeout(done, Math.min(remaining, 2000));
				this.bell.once("result:" + id, done);
			});
		}
	}

	static toView(c: CommandRow) {
		return {
			id: c.id,
			agentId: c.agent_id,
			type: c.type,
			requestId: c.request_id,
			state: c.state,
			payload: c.payload,
			result: c.result ?? null,
			error: c.error ?? null,
			onecHttpStatus: c.onec_http_status,
			createdAt: c.created_at.toISOString(),
			dispatchedAt: c.dispatched_at?.toISOString() ?? null,
			finishedAt: c.finished_at?.toISOString() ?? null,
		};
	}
}
