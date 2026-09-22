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

import type { Db } from "../db/pool.ts";

export type BaseOrganization = { bin: string; name: string | null; onecId: string | null };

/** БИН Казахстана — 12 цифр; всё остальное не организация, а мусор во входных данных. */
export const isBin = (v: unknown): v is string => typeof v === "string" && /^\d{12}$/.test(v.trim());

export class BaseOrganizationsStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/** Пополнить список базы. Молча пропускает строки без корректного БИН. */
	async remember(baseId: string, orgs: { bin?: string | null; name?: string | null; id?: string | null }[]): Promise<number> {
		const rows = orgs.filter((o) => isBin(o.bin)).map((o) => ({ bin: String(o.bin).trim(), name: o.name ?? null, onecId: o.id ?? null }));
		if (!rows.length) return 0;
		const r = await this.db.query(
			`INSERT INTO base_organizations (base_id, bin, name, onec_id)
			 SELECT $1, x.bin, x.name, x.onec_id
			   FROM unnest($2::text[], $3::text[], $4::text[]) AS x(bin, name, onec_id)
			 ON CONFLICT (base_id, bin) DO UPDATE
			    SET name = COALESCE(EXCLUDED.name, base_organizations.name),
			        onec_id = COALESCE(EXCLUDED.onec_id, base_organizations.onec_id),
			        updated_at = now()`,
			[baseId, rows.map((x) => x.bin), rows.map((x) => x.name), rows.map((x) => x.onecId)],
		);
		return r.rowCount ?? 0;
	}

	async list(baseId: string): Promise<BaseOrganization[]> {
		const r = await this.db.query<{ bin: string; name: string | null; onec_id: string | null }>(
			`SELECT bin, name, onec_id FROM base_organizations WHERE base_id = $1 ORDER BY name NULLS LAST, bin`,
			[baseId],
		);
		return r.rows.map((x) => ({ bin: x.bin, name: x.name, onecId: x.onec_id }));
	}

	/** Принадлежит ли БИН этой базе. */
	async has(baseId: string, bin: string): Promise<boolean> {
		if (!isBin(bin)) return false;
		const r = await this.db.query(`SELECT 1 FROM base_organizations WHERE base_id = $1 AND bin = $2`, [baseId, bin.trim()]);
		return (r.rowCount ?? 0) > 0;
	}
}
