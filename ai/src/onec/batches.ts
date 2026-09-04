/**
 * Пакетные операции по базам (E15/A4): одна команда пользователя → N команд по базам.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СУЩНОСТЬ. «Создать пользователя во всех базах» — это сто независимых
 * подключений к 1С, каждое со своим итогом. Без задания пользователь увидел бы сто
 * несвязанных операций и не понял, где что упало и что повторять.
 *
 * ПРОГРЕСС НЕ ХРАНИМ. Счётчики done/failed считаются запросом по commands.batch_id:
 * дублировать их колонками — значит держать две правды в согласии, а команда может
 * завершиться, истечь по TTL или быть переставлена в очереди.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

export type BatchProgress = {
	id: string;
	type: string;
	total: number;
	done: number;
	failed: number;
	pending: number;
	createdAt: string;
	items: { baseKey: string | null; state: string; error: { code: string; message: string } | null }[];
};

export class BatchService {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	async create(input: {
		organizationUuid: string;
		userUuid: string | null;
		type: string;
		payload: Record<string, unknown>;
		total: number;
	}): Promise<string> {
		const id = randomUUID();
		await this.db.query(
			`INSERT INTO command_batches (id, organization_uuid, user_uuid, type, payload, total)
			 VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
			[id, input.organizationUuid, input.userUuid, input.type, JSON.stringify(input.payload), input.total],
		);
		return id;
	}

	async attach(batchId: string, commandId: string): Promise<void> {
		await this.db.query(`UPDATE commands SET batch_id = $1 WHERE id = $2`, [batchId, commandId]);
	}

	async progress(id: string): Promise<BatchProgress | null> {
		const b = await this.db.query<{ id: string; type: string; total: number; created_at: Date }>(
			`SELECT id, type, total, created_at FROM command_batches WHERE id = $1`, [id],
		);
		const head = b.rows[0];
		if (!head) return null;

		const c = await this.db.query<{ base_key: string | null; state: string; error: { code: string; message: string } | null }>(
			`SELECT base_key, state, error FROM commands WHERE batch_id = $1 ORDER BY created_at`, [id],
		);
		const items = c.rows.map((r) => ({ baseKey: r.base_key, state: r.state, error: r.error }));
		const done = items.filter((i) => i.state === "done").length;
		// expired считаем неуспехом: команда не выполнена, и повторять её придётся так же.
		const failed = items.filter((i) => i.state === "failed" || i.state === "expired").length;
		return {
			id: head.id, type: head.type, total: head.total,
			done, failed, pending: Math.max(0, head.total - done - failed),
			createdAt: head.created_at.toISOString(), items,
		};
	}

	/** Последние задания организации — для вкладки «Задания». */
	async list(organizationUuid: string, limit = 20): Promise<BatchProgress[]> {
		const r = await this.db.query<{ id: string }>(
			`SELECT id FROM command_batches WHERE organization_uuid = $1 ORDER BY created_at DESC LIMIT $2`,
			[organizationUuid, limit],
		);
		const out: BatchProgress[] = [];
		for (const row of r.rows) {
			const p = await this.progress(row.id);
			if (p) out.push(p);
		}
		return out;
	}
}
