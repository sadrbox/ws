// Организации базы 1С: какие БИНы эта база вправе называть.
//
// Задачи и заметки живут в ERP и адресуются БИНом организации, выбранной в форме чата. Токен базы
// несёт одну организацию ERP, а база бывает многофирменной — поэтому список ведётся отдельно.
// Проверка простая и обязательная: БИН из запроса должен быть в списке ЭТОЙ базы, иначе по чужому
// БИН можно было бы прочитать чужие задачи, имея лишь свой токен.
//
// Откуда берётся: из заявки на регистрацию базы (организации приходят в ней) и из самой базы —
// форма шлёт свой список при открытии, потому что организацию могли завести уже после регистрации.
// Список пользователя сужен его правами (`РАЗРЕШЕННЫЕ`), поэтому пополнение идёт объединением, а
// не заменой: иначе бухгалтер с одной организацией стёр бы остальные.
//
// ДЕЙСТВУЕТ ТОЛЬКО ОДОБРЕННОЕ (Б11 аудита 26.09). Раньше база пополняла список сама и без одобрения: любой
// держатель токена базы называл ЛЮБОЙ БИН и читал, заводил и закрывал задачи и заметки чужой организации.
// Теперь БИН, присланный самой базой, встаёт ожидающим; действует он, только если одобрен:
//   — пришёл в заявке на регистрацию, которую одобрил оператор (`registration`);
//   — это БИН организации ERP, на которую выдан токен базы (`token`): эту привязку сделал оператор;
//   — одобрен администратором BuhProf в панели (`panel`).

import type { Db } from "../db/pool.ts";

export type BaseOrganization = { bin: string; name: string | null; onecId: string | null; approved: boolean };

/** Откуда БИН базы: одобренная заявка, организация токена, сама база, решение в панели. */
export type BaseOrgSource = "registration" | "token" | "base" | "panel";

/** Ожидающий одобрения БИН — для панели администратора BuhProf. */
export type PendingBaseOrganization = { baseId: string; bin: string; name: string | null; onecId: string | null; createdAt: Date; updatedAt: Date };

/** БИН Казахстана — 12 цифр; всё остальное не организация, а мусор во входных данных. */
export const isBin = (v: unknown): v is string => typeof v === "string" && /^\d{12}$/.test(v.trim());

export class BaseOrganizationsStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/**
	 * Пополнить список базы. Молча пропускает строки без корректного БИН.
	 *
	 * `approvedBy` — кто одобрил (заявку на регистрацию): такие БИНы действуют сразу. Без него — прислала сама база:
	 * новые БИНы встают ожидающими, а у известных обновляются только имя и ссылка, одобрение не меняется.
	 * Возвращает, сколько строк записано, и какие из присланных БИНов ещё ждут одобрения.
	 */
	async remember(
		baseId: string,
		orgs: { bin?: string | null; name?: string | null; id?: string | null }[],
		opts: { approvedBy?: string | null; source?: BaseOrgSource } = {},
	): Promise<{ remembered: number; pending: string[] }> {
		const seen = new Set<string>();
		const rows = orgs.filter((o) => isBin(o.bin)).map((o) => ({ bin: String(o.bin).trim(), name: o.name ?? null, onecId: o.id ?? null }))
			.filter((o) => !seen.has(o.bin) && !!seen.add(o.bin));
		if (!rows.length) return { remembered: 0, pending: [] };
		const approvedBy = opts.approvedBy ?? null;
		const r = await this.db.query<{ bin: string; approved_at: Date | null }>(
			`INSERT INTO base_organizations (base_id, bin, name, onec_id, approved_at, approved_by, source)
			 SELECT $1, x.bin, x.name, x.onec_id, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5, $6
			   FROM unnest($2::text[], $3::text[], $4::text[]) AS x(bin, name, onec_id)
			 ON CONFLICT (base_id, bin) DO UPDATE
			    SET name = COALESCE(EXCLUDED.name, base_organizations.name),
			        onec_id = COALESCE(EXCLUDED.onec_id, base_organizations.onec_id),
			        -- Одобрение только добавляется: присланное самой базой (без одобрившего) его не снимает.
			        approved_at = COALESCE(base_organizations.approved_at, EXCLUDED.approved_at),
			        approved_by = COALESCE(base_organizations.approved_by, EXCLUDED.approved_by),
			        source = CASE WHEN base_organizations.approved_at IS NULL AND EXCLUDED.approved_at IS NOT NULL
			                      THEN EXCLUDED.source ELSE base_organizations.source END,
			        updated_at = now()
			 RETURNING bin, approved_at`,
			[baseId, rows.map((x) => x.bin), rows.map((x) => x.name), rows.map((x) => x.onecId), approvedBy, opts.source ?? (approvedBy ? "registration" : "base")],
		);
		return { remembered: r.rowCount ?? 0, pending: r.rows.filter((x) => !x.approved_at).map((x) => x.bin) };
	}

	/**
	 * Одобрить БИН базы: организация токена базы (`token`) или решение администратора в панели (`panel`). Строки нет —
	 * заводится сразу одобренной. Возвращает, изменилось ли что-то.
	 */
	async approve(baseId: string, bin: string, by: string, source: BaseOrgSource, name: string | null = null): Promise<boolean> {
		if (!isBin(bin)) return false;
		const r = await this.db.query(
			`INSERT INTO base_organizations (base_id, bin, name, approved_at, approved_by, source)
			 VALUES ($1, $2, $3, now(), $4, $5)
			 ON CONFLICT (base_id, bin) DO UPDATE
			    SET approved_at = now(), approved_by = $4, source = $5, name = COALESCE(base_organizations.name, EXCLUDED.name), updated_at = now()
			  WHERE base_organizations.approved_at IS NULL`,
			[baseId, bin.trim(), name, by, source],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/** Отклонить ожидающий БИН: строка убирается, одобренные не трогаются. База может прислать его снова. */
	async rejectPending(baseId: string, bin: string): Promise<boolean> {
		const r = await this.db.query(`DELETE FROM base_organizations WHERE base_id = $1 AND bin = $2 AND approved_at IS NULL`, [baseId, bin.trim()]);
		return (r.rowCount ?? 0) > 0;
	}

	/** Ожидающие одобрения БИНы всех баз — для панели администратора BuhProf. */
	async pending(limit = 300): Promise<PendingBaseOrganization[]> {
		const r = await this.db.query<{ base_id: string; bin: string; name: string | null; onec_id: string | null; created_at: Date; updated_at: Date }>(
			`SELECT base_id, bin, name, onec_id, created_at, updated_at FROM base_organizations
			  WHERE approved_at IS NULL ORDER BY created_at DESC LIMIT $1`,
			[Math.min(Math.max(limit, 1), 1000)],
		);
		return r.rows.map((x) => ({ baseId: x.base_id, bin: x.bin, name: x.name, onecId: x.onec_id, createdAt: x.created_at, updatedAt: x.updated_at }));
	}

	async list(baseId: string): Promise<BaseOrganization[]> {
		const r = await this.db.query<{ bin: string; name: string | null; onec_id: string | null; approved_at: Date | null }>(
			`SELECT bin, name, onec_id, approved_at FROM base_organizations WHERE base_id = $1 ORDER BY name NULLS LAST, bin`,
			[baseId],
		);
		return r.rows.map((x) => ({ bin: x.bin, name: x.name, onecId: x.onec_id, approved: !!x.approved_at }));
	}

	/** Принадлежит ли БИН этой базе — только одобренный (Б11 аудита 26.09). */
	async has(baseId: string, bin: string): Promise<boolean> {
		if (!isBin(bin)) return false;
		const r = await this.db.query(`SELECT 1 FROM base_organizations WHERE base_id = $1 AND bin = $2 AND approved_at IS NOT NULL`, [baseId, bin.trim()]);
		return (r.rowCount ?? 0) > 0;
	}
}
