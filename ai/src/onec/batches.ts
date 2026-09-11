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
import { humanizeAgentError } from "./errorHints.ts";
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
	items: {
		baseKey: string | null; state: string; error: { code: string; message: string } | null;
		/** Итог операции одной строкой: путь к выгрузке, адрес публикации. */
		outcome: string | null;
	}[];
};

/**
 * Через сколько считать команду задания потерянной. Команды живут час (`expires_at`) и
 * вычищаются, а задание остаётся навсегда: без этого срока оно вечно показывало бы
 * «выполняется», ожидая того, кого уже нет.
 */
const LOST_AFTER_MS = 2 * 60 * 60 * 1000;

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
		// Просроченные команды закрываем перед чтением отчёта: иначе задание, чьи команды
		// никто не забрал, вечно показывает «выполняется».
		await this.db.query(
			// Причину пишем здесь же: после перевода в expired уже не отличить «не забрал»
			// (это про связь) от «забрал и не ответил» (это про базу).
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', 'COMMAND_EXPIRED',
			          'message', CASE WHEN state = 'queued'
			            THEN 'Агент не забрал команду до истечения срока — служба 1С-агента не на связи.'
			            ELSE 'Агент забрал команду, но не ответил за отведённое ей время. Проверьте базу и журнал агента.'
			          END))
			  WHERE batch_id = $1 AND state IN ('queued','dispatched') AND expires_at < now()`, [id],
		);
		const b = await this.db.query<{ id: string; type: string; total: number; created_at: Date }>(
			`SELECT id, type, total, created_at FROM command_batches WHERE id = $1`, [id],
		);
		const head = b.rows[0];
		if (!head) return null;

		const c = await this.db.query<{
			base_key: string | null; state: string; error: { code: string; message: string } | null; outcome: string | null;
		}>(
			// Путь и адрес — единственное, что имеет смысл показать из результата: остальное
			// у изменяющих команд это `{ok:true}`. Полный result в отчёт не тащим.
			`SELECT base_key, state, error, COALESCE(result->>'path', result->>'url') AS outcome
			   FROM commands WHERE batch_id = $1 ORDER BY created_at`, [id],
		);
		// Ошибку 1С/COM дополняем подсказкой «что чинить»: сырой HRESULT в отчёте задания
		// не говорит пользователю ничего, а искать его в логах на Windows-машине дорого.
		// Контекст входа в базу: у каких баз задана своя учётная запись и умеет ли её
		// применять хоть один админ-агент. Без этого отказ «проверьте служебного
		// администратора» выглядит одинаково и когда учётная запись неверна, и когда её
		// просто не применили — а это разные дела: во втором случае чинят агента.
		const keys = [...new Set(c.rows.map((r) => r.base_key).filter((k): k is string => !!k))];
		const authUsers = keys.length
			? (await this.db.query<{ key: string; user_name: string }>(
				`SELECT b.key, c.user_name FROM base_credentials c JOIN bases b ON b.id = c.base_id
				  WHERE b.key = ANY($1::text[])`, [keys],
			)).rows
			: [];
		const authByKey = new Map(authUsers.filter((x) => x.user_name).map((x) => [x.key, x.user_name]));
		const supports = authByKey.size > 0 && (await this.db.query<{ ok: boolean }>(
			`SELECT EXISTS (
			   SELECT 1 FROM agents WHERE role = 'admin' AND capabilities ? 'ib.auth'
			 ) AS ok`,
		)).rows[0]?.ok === true;

		const items = c.rows.map((r) => ({
			baseKey: r.base_key,
			state: r.state,
			error: humanizeAgentError(r.error, r.base_key
				? { baseAuthUser: authByKey.get(r.base_key) ?? null, agentSupportsBaseAuth: supports }
				: {}),
			outcome: r.outcome,
		}));
		// Команд может НЕ ХВАТАТЬ: они живут час и вычищаются, а задание остаётся. Без этого
		// такое задание вечно показывало «выполняется 1 из 1» — хотя ждать уже некого.
		const ageMs = Date.now() - head.created_at.getTime();
		const missing = head.total - items.length;
		if (missing > 0 && ageMs > LOST_AFTER_MS) {
			for (let i = 0; i < missing; i++) {
				items.push({
					baseKey: null, state: "expired", outcome: null,
					error: { code: "COMMAND_LOST", message: "Команда не найдена: срок её жизни истёк. Повторите операцию." },
				});
			}
		}

		const done = items.filter((i) => i.state === "done").length;
		// expired считаем неуспехом: команда не выполнена, и повторять её придётся так же.
		const failed = items.filter((i) => i.state === "failed" || i.state === "expired").length;
		return {
			id: head.id, type: head.type, total: head.total,
			done, failed, pending: Math.max(0, head.total - done - failed),
			createdAt: head.created_at.toISOString(), items,
		};
	}

	/**
	 * Команды задания, которые не удались. `expired` считаем неуспехом наравне с `failed`:
	 * команда не выполнена, и повторять её нужно так же.
	 */
	async failedCommands(batchId: string): Promise<{ base_key: string | null; type: string; payload: Record<string, unknown> }[]> {
		const r = await this.db.query<{ base_key: string | null; type: string; payload: Record<string, unknown> }>(
			`SELECT base_key, type, payload FROM commands
			  WHERE batch_id = $1 AND state IN ('failed', 'expired') ORDER BY created_at`,
			[batchId],
		);
		return r.rows;
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
