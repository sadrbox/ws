// Запросы активации БИНов бизнес-агента (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 2).
//
// Агент шлёт запросы в heartbeat, пока сервис их не принял; повтор того же БИН — обновление прежнего запроса, а не
// новый. Решение администратора BuhProf уходит агенту в ответах register/heartbeat (`activation`, 90 дней).

import type { Db } from "../db/pool.ts";

export type ActivationState = "PENDING" | "APPROVED" | "REJECTED";

/** Запрос, как его прислал агент (разобран схемой heartbeat). */
export type ActivationInput = { bin: string; name?: string | null; baseKey?: string | null; comment?: string | null; requestedAt?: string | null };

export type ActivationRow = {
	agentId: string; bin: string; name: string | null; baseKey: string | null; comment: string | null;
	requestedAt: Date | null; state: ActivationState; note: string | null; decidedBy: string | null; decidedAt: Date | null;
	createdAt: Date; updatedAt: Date;
};

type Raw = {
	agent_id: string; bin: string; name: string | null; base_key: string | null; comment: string | null;
	requested_at: Date | null; state: ActivationState; note: string | null; decided_by: string | null; decided_at: Date | null;
	created_at: Date; updated_at: Date;
};

const COLS = "agent_id, bin, name, base_key, comment, requested_at, state, note, decided_by, decided_at, created_at, updated_at";

const toRow = (r: Raw): ActivationRow => ({
	agentId: r.agent_id, bin: r.bin, name: r.name, baseKey: r.base_key, comment: r.comment, requestedAt: r.requested_at,
	state: r.state, note: r.note, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Решения, которые агент показывает в окне: за 90 дней (контракт). */
export const ACTIVATION_HISTORY_DAYS = 90;

const validDate = (v: string | null | undefined): string | null => (v && !Number.isNaN(Date.parse(v)) ? v : null);

export class ActivationStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/**
	 * Принять запросы из heartbeat. Повтор — обновление прежнего запроса. Решённый заново становится нерешённым,
	 * если БИН сейчас не активен: клиент просит снова (после отказа или после «Отключить»). Запрос уже активного БИН
	 * решения не меняет — просить нечего.
	 */
	async upsert(agentId: string, requests: readonly ActivationInput[], activeBins: readonly string[] | null): Promise<string[]> {
		const seen = new Set<string>();
		const rows = requests.map((q) => ({ ...q, bin: q.bin.trim() })).filter((q) => !!q.bin && !seen.has(q.bin) && !!seen.add(q.bin));
		if (!rows.length) return [];
		/*
		 * ЧТО ИЗМЕНИЛОСЬ, А НЕ ЧТО ПРИШЛО (аудит 21.09). Агент повторяет запрос в каждом heartbeat, пока сервис его
		 * не принял, — и аудит заполнялся одним и тем же событием раз в полминуты. Запись о запросе нужна, когда он
		 * ПОЯВИЛСЯ или открылся заново после решения; прежнее состояние читается до записи.
		 */
		const before = await this.db.query<{ bin: string; state: ActivationState }>(
			`SELECT bin, state FROM bin_activation_requests WHERE agent_id = $1 AND bin = ANY($2::text[])`,
			[agentId, rows.map((q) => q.bin)],
		);
		const known = new Map(before.rows.map((x) => [x.bin, x.state]));
		await this.db.query(
			`INSERT INTO bin_activation_requests (agent_id, bin, name, base_key, comment, requested_at)
			 SELECT $1, x.bin, x.name, x.base_key, x.comment, x.requested_at::timestamptz
			   FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(bin, name, base_key, comment, requested_at)
			 ON CONFLICT (agent_id, bin) DO UPDATE
			    SET name = COALESCE(EXCLUDED.name, bin_activation_requests.name),
			        base_key = COALESCE(EXCLUDED.base_key, bin_activation_requests.base_key),
			        comment = COALESCE(EXCLUDED.comment, bin_activation_requests.comment),
			        requested_at = COALESCE(EXCLUDED.requested_at, bin_activation_requests.requested_at),
			        state = CASE WHEN bin_activation_requests.state <> 'PENDING' AND NOT (EXCLUDED.bin = ANY($7::text[]))
			                     THEN 'PENDING' ELSE bin_activation_requests.state END,
			        note = CASE WHEN bin_activation_requests.state <> 'PENDING' AND NOT (EXCLUDED.bin = ANY($7::text[]))
			                    THEN NULL ELSE bin_activation_requests.note END,
			        updated_at = now()`,
			[
				agentId,
				rows.map((q) => q.bin),
				rows.map((q) => q.name?.trim() || null),
				rows.map((q) => q.baseKey?.trim() || null),
				rows.map((q) => q.comment?.trim() || null),
				rows.map((q) => validDate(q.requestedAt)),
				[...(activeBins ?? [])],
			],
		);
		const active = new Set(activeBins ?? []);
		return rows
			.map((q) => q.bin)
			.filter((bin) => {
				const was = known.get(bin);
				// Новый запрос или решённый, который агент просит заново (и БИН сейчас не активен).
				return was === undefined || (was !== "PENDING" && !active.has(bin));
			});
	}

	/** Решения по запросам агента за 90 дней — для ответа register/heartbeat. */
	async decisions(agentId: string): Promise<{ bin: string; state: ActivationState; note: string | null; decidedAt: string | null }[]> {
		const r = await this.db.query<Raw>(
			`SELECT ${COLS} FROM bin_activation_requests
			  WHERE agent_id = $1 AND updated_at > now() - make_interval(days => $2::int)
			  ORDER BY updated_at DESC`,
			[agentId, ACTIVATION_HISTORY_DAYS],
		);
		return r.rows.map((x) => ({ bin: x.bin, state: x.state, note: x.note, decidedAt: x.decided_at?.toISOString() ?? null }));
	}

	async get(agentId: string, bin: string): Promise<ActivationRow | null> {
		const r = await this.db.query<Raw>(`SELECT ${COLS} FROM bin_activation_requests WHERE agent_id = $1 AND bin = $2`, [agentId, bin]);
		return r.rows[0] ? toRow(r.rows[0]) : null;
	}

	/** Для панели: нерешённые — первыми. */
	async list(opts: { state?: ActivationState | null; agentId?: string | null } = {}): Promise<ActivationRow[]> {
		const r = await this.db.query<Raw>(
			`SELECT ${COLS} FROM bin_activation_requests
			  WHERE ($1::text IS NULL OR state = $1) AND ($2::uuid IS NULL OR agent_id = $2::uuid)
			  ORDER BY (state = 'PENDING') DESC, updated_at DESC
			  LIMIT 500`,
			[opts.state ?? null, opts.agentId ?? null],
		);
		return r.rows.map(toRow);
	}

	async decide(agentId: string, bin: string, d: { state: "APPROVED" | "REJECTED"; decidedBy: string; note?: string | null }): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE bin_activation_requests SET state = $3, decided_by = $4, note = $5, decided_at = now(), updated_at = now()
			  WHERE agent_id = $1 AND bin = $2 AND state = 'PENDING'`,
			[agentId, bin, d.state, d.decidedBy, d.note ?? null],
		);
		return (r.rowCount ?? 0) > 0;
	}
}
