/**
 * Кэш содержимого баз: пользователи ИБ и расширения (E15/A3-P1).
 *
 * ЗАЧЕМ КЭШ. Вопрос «в каких базах есть пользователь Иванов» без него означает сто
 * подключений к 1С на каждый показ — минуты ожидания и сто занятых сеансов. Поэтому
 * результат IB_LIST_USERS/IB_LIST_EXTENSIONS складывается сюда, а сводные экраны
 * читают базу сервиса. Это ИМЕННО кэш: источник истины — сама 1С, и рядом с данными
 * всегда показывается, когда их последний раз видели (seen_at).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

export type IbUser = { name: string; fullName?: string; disabled?: boolean; roles?: string[] };
export type IbExtension = { name: string; version?: string | null; purpose?: string | null; safeMode?: boolean | null };

export type UserOccurrence = {
	baseKey: string; baseName: string; serverName: string;
	fullName: string; disabled: boolean; roles: string[]; seenAt: string;
};

export class OnecRegistry {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	/** Полный срез пользователей базы: пропавшие удаляем — иначе сводка врёт. */
	async syncUsers(baseId: string, users: IbUser[]): Promise<void> {
		for (const u of users) {
			const name = (u.name ?? "").trim();
			if (!name) continue;
			await this.db.query(
				`INSERT INTO base_users (id, base_id, name, full_name, disabled, roles, seen_at)
				 VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, false), $6::jsonb, now())
				 ON CONFLICT (base_id, lower(name)) DO UPDATE
				    SET name = EXCLUDED.name, full_name = EXCLUDED.full_name,
				        disabled = EXCLUDED.disabled, roles = EXCLUDED.roles, seen_at = now()`,
				[randomUUID(), baseId, name, u.fullName ?? null, u.disabled ?? null, JSON.stringify(u.roles ?? [])],
			);
		}
		await this.db.query(
			`DELETE FROM base_users WHERE base_id = $1 AND NOT (lower(name) = ANY($2::text[]))`,
			[baseId, users.map((u) => (u.name ?? "").trim().toLowerCase()).filter(Boolean)],
		);
	}

	async syncExtensions(baseId: string, items: IbExtension[]): Promise<void> {
		for (const e of items) {
			const name = (e.name ?? "").trim();
			if (!name) continue;
			await this.db.query(
				`INSERT INTO base_extensions (id, base_id, name, version, purpose, safe_mode, seen_at)
				 VALUES ($1, $2, $3, $4, $5, $6, now())
				 ON CONFLICT (base_id, lower(name)) DO UPDATE
				    SET name = EXCLUDED.name, version = EXCLUDED.version, purpose = EXCLUDED.purpose,
				        safe_mode = EXCLUDED.safe_mode, seen_at = now()`,
				[randomUUID(), baseId, name, e.version ?? null, e.purpose ?? null, e.safeMode ?? null],
			);
		}
		await this.db.query(
			`DELETE FROM base_extensions WHERE base_id = $1 AND NOT (lower(name) = ANY($2::text[]))`,
			[baseId, items.map((e) => (e.name ?? "").trim().toLowerCase()).filter(Boolean)],
		);
	}

	/** Где встречается пользователь — ответ на «покажи его во всех базах». */
	async findUser(name: string): Promise<UserOccurrence[]> {
		const r = await this.db.query<{
			key: string; base_name: string; server_name: string;
			full_name: string; disabled: boolean; roles: string[]; seen_at: Date;
		}>(
			`SELECT b.key, b.name AS base_name, s.name AS server_name,
			        u.full_name, u.disabled, u.roles, u.seen_at
			   FROM base_users u
			   JOIN bases b ON b.id = u.base_id
			   JOIN servers s ON s.id = b.server_id
			  WHERE lower(u.name) = lower($1)
			  ORDER BY s.name, b.key`,
			[name],
		);
		return r.rows.map((x) => ({
			baseKey: x.key, baseName: x.base_name, serverName: x.server_name,
			fullName: x.full_name, disabled: x.disabled, roles: x.roles ?? [], seenAt: x.seen_at.toISOString(),
		}));
	}

	/** Сводка по всем базам: кто где есть — список имён с числом баз. */
	async userSummary(): Promise<{ name: string; bases: number; disabled: number }[]> {
		const r = await this.db.query<{ name: string; bases: string; disabled: string }>(
			`SELECT min(name) AS name, count(*)::text AS bases,
			        count(*) FILTER (WHERE disabled)::text AS disabled
			   FROM base_users GROUP BY lower(name) ORDER BY min(name)`,
		);
		return r.rows.map((x) => ({ name: x.name, bases: Number(x.bases), disabled: Number(x.disabled) }));
	}

	/** Сводка по расширениям: имя, версии, в скольких базах стоит. */
	async extensionSummary(): Promise<{ name: string; bases: number; versions: string[] }[]> {
		const r = await this.db.query<{ name: string; bases: string; versions: (string | null)[] }>(
			`SELECT min(name) AS name, count(*)::text AS bases,
			        array_agg(DISTINCT version) AS versions
			   FROM base_extensions GROUP BY lower(name) ORDER BY min(name)`,
		);
		return r.rows.map((x) => ({
			name: x.name, bases: Number(x.bases),
			versions: (x.versions ?? []).filter((v): v is string => !!v),
		}));
	}

	async usersOfBase(baseId: string): Promise<(IbUser & { seenAt: string })[]> {
		const r = await this.db.query<{ name: string; full_name: string; disabled: boolean; roles: string[]; seen_at: Date }>(
			`SELECT name, full_name, disabled, roles, seen_at FROM base_users WHERE base_id = $1 ORDER BY name`, [baseId],
		);
		return r.rows.map((x) => ({
			name: x.name, fullName: x.full_name, disabled: x.disabled,
			roles: x.roles ?? [], seenAt: x.seen_at.toISOString(),
		}));
	}

	async extensionsOfBase(baseId: string): Promise<(IbExtension & { seenAt: string })[]> {
		const r = await this.db.query<{ name: string; version: string | null; purpose: string | null; safe_mode: boolean | null; seen_at: Date }>(
			`SELECT name, version, purpose, safe_mode, seen_at FROM base_extensions WHERE base_id = $1 ORDER BY name`, [baseId],
		);
		return r.rows.map((x) => ({
			name: x.name, version: x.version, purpose: x.purpose,
			safeMode: x.safe_mode, seenAt: x.seen_at.toISOString(),
		}));
	}
}
