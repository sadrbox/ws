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

export type IbUser = {
	name: string; fullName?: string; disabled?: boolean; roles?: string[];
	/**
	 * Показывать в списке выбора при входе. Трёхзначно: отсутствие поля — «агент не
	 * сообщил», а не «нет». Панель умеет этот признак записывать, но пока не всякая сборка
	 * агента возвращает его в списке пользователей — и выдавать незнание за «выключено»
	 * значило бы показывать выдуманное значение как факт.
	 */
	showInList?: boolean | null;
};
export type IbExtension = {
	name: string;
	/** Синоним — человеческое имя расширения; служебное Имя часто нечитаемо. */
	synonym?: string | null;
	version?: string | null; purpose?: string | null; safeMode?: boolean | null;
};

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
				`INSERT INTO base_users (id, base_id, name, full_name, disabled, roles, show_in_list, seen_at)
				 VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, false), $6::jsonb, $7, now())
				 ON CONFLICT (base_id, lower(name)) DO UPDATE
				    SET name = EXCLUDED.name, full_name = EXCLUDED.full_name,
				        disabled = EXCLUDED.disabled, roles = EXCLUDED.roles,
				        -- «Поля нет» значит «агент не сообщил»: прежнее знание сохраняем, как
				        -- и у публикации. Иначе сборка, которая признак не отдаёт, стирала бы
				        -- его при каждом чтении списка.
				        show_in_list = COALESCE(EXCLUDED.show_in_list, base_users.show_in_list),
				        seen_at = now()`,
				[randomUUID(), baseId, name, u.fullName ?? null, u.disabled ?? null,
					JSON.stringify(u.roles ?? []), u.showInList ?? null],
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
				`INSERT INTO base_extensions (id, base_id, name, synonym, version, purpose, safe_mode, seen_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
				 ON CONFLICT (base_id, lower(name)) DO UPDATE
				    SET name = EXCLUDED.name, synonym = COALESCE(EXCLUDED.synonym, base_extensions.synonym),
				        version = EXCLUDED.version, purpose = EXCLUDED.purpose,
				        safe_mode = EXCLUDED.safe_mode, seen_at = now()`,
				[randomUUID(), baseId, name, e.synonym ?? null, e.version ?? null, e.purpose ?? null, e.safeMode ?? null],
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
	/**
	 * Роли, встречавшиеся в базах, — по кэшу прочитанных пользователей.
	 *
	 * Это не справочник конфигурации (его отдаёт IB_LIST_ROLES у самой базы), а то, что мы
	 * УЖЕ видели: ролей в типовой конфигурации сотни, но реально назначают десяток, и для
	 * выбора при создании пользователя этого достаточно. Работает без обращения к 1С.
	 */
	async knownRoles(baseKey?: string): Promise<{ name: string; users: number }[]> {
		const r = await this.db.query<{ name: string; users: string }>(
			`SELECT role AS name, count(*)::text AS users
			   FROM base_users u
			   JOIN bases b ON b.id = u.base_id
			   CROSS JOIN LATERAL jsonb_array_elements_text(u.roles) AS role
			  WHERE ($1::text IS NULL OR b.key = $1)
			  GROUP BY role
			  ORDER BY count(*) DESC, role`,
			[baseKey ?? null],
		);
		return r.rows.map((x) => ({ name: x.name, users: Number(x.users) }));
	}

	/**
	 * Сколько пользователей в каждой базе держат указанную роль.
	 *
	 * Нужно ровно для одной защиты: снятие «ПолныеПрава» у ЕДИНСТВЕННОГО администратора
	 * оставляет базу без администратора вовсе. Без этих чисел панель не может отличить
	 * безопасное снятие от разрушительного и вынуждена либо запрещать всё, либо всё
	 * разрешать. Считается по кэшу прочитанных пользователей, в 1С не ходит.
	 */
	async roleHolders(role: string): Promise<{ baseKey: string; users: number }[]> {
		const r = await this.db.query<{ key: string; users: string }>(
			`SELECT b.key, count(*)::text AS users
			   FROM base_users u
			   JOIN bases b ON b.id = u.base_id
			  WHERE u.roles ? $1 AND NOT u.disabled
			  GROUP BY b.key`,
			[role],
		);
		return r.rows.map((x) => ({ baseKey: x.key, users: Number(x.users) }));
	}

	/**
	 * Сводка по пользователям. Роли — ОБЪЕДИНЕНИЕ по всем базам, где человек заведён.
	 *
	 * Объединение, а не пересечение: список отвечает на вопрос «что этот человек вообще
	 * может», и роль, выданная хоть в одной базе, для этого ответа существенна. Где
	 * именно она есть, показывает карточка — но ради простого просмотра списка второй
	 * запрос на человека делать незачем.
	 */
	async userSummary(): Promise<{ name: string; bases: number; disabled: number; roles: string[] }[]> {
		const r = await this.db.query<{ name: string; bases: string; disabled: string; roles: string[] }>(
			`SELECT min(name) AS name, count(*)::text AS bases,
			        count(*) FILTER (WHERE disabled)::text AS disabled,
			        COALESCE(
			          (SELECT array_agg(DISTINCT role ORDER BY role)
			             FROM base_users u2, jsonb_array_elements_text(u2.roles) role
			            WHERE lower(u2.name) = lower(min(base_users.name))),
			          ARRAY[]::text[]) AS roles
			   FROM base_users GROUP BY lower(name) ORDER BY min(name)`,
		);
		return r.rows.map((x) => ({
			name: x.name, bases: Number(x.bases), disabled: Number(x.disabled), roles: x.roles ?? [],
		}));
	}

	/**
	 * Что делали с этим пользователем из панели: команды по его имени.
	 *
	 * История берётся из очереди команд — единственного места, где записано, кто и что
	 * менял. Без неё вопрос «кто снял человеку права» остаётся без ответа, а на сотне
	 * клиентских баз он рано или поздно задаётся.
	 */
	async userHistory(name: string, limit = 50): Promise<{
		type: string; baseKey: string | null; state: string; createdAt: string; error: string | null;
	}[]> {
		const r = await this.db.query<{
			type: string; base_key: string | null; state: string; created_at: Date; error: string | null;
		}>(
			`SELECT type, base_key, state, created_at, error->>'message' AS error
			   FROM commands
			  WHERE type IN ('IB_CREATE_USER','IB_UPDATE_USER','IB_DELETE_USER')
			    AND lower(payload->>'name') = lower($1)
			  ORDER BY created_at DESC
			  LIMIT $2`,
			[name, limit],
		);
		return r.rows.map((x) => ({
			type: x.type, baseKey: x.base_key, state: x.state,
			createdAt: x.created_at.toISOString(), error: x.error,
		}));
	}

	/**
	 * Сводка по расширениям: имя + синоним, версии, в скольких базах стоит.
	 *
	 * Группируем по ПАРЕ имя+синоним: одно и то же служебное имя в разных базах может
	 * принадлежать разным расширениям (типовые «EF_00_…» — исправления от поставщика),
	 * и склеивать их в одну строку значило бы врать о том, что стоит одинаковое.
	 */
	async extensionSummary(): Promise<{ name: string; synonym: string; bases: number; versions: string[] }[]> {
		const r = await this.db.query<{ name: string; synonym: string | null; bases: string; versions: (string | null)[] }>(
			`SELECT min(name) AS name, coalesce(min(synonym), '') AS synonym, count(*)::text AS bases,
			        array_agg(DISTINCT version) AS versions
			   FROM base_extensions
			  GROUP BY lower(name), lower(coalesce(synonym, ''))
			  ORDER BY min(name)`,
		);
		return r.rows.map((x) => ({
			name: x.name, synonym: x.synonym ?? "", bases: Number(x.bases),
			versions: (x.versions ?? []).filter((v): v is string => !!v),
		}));
	}

	async usersOfBase(baseId: string): Promise<(IbUser & { seenAt: string })[]> {
		const r = await this.db.query<{
			name: string; full_name: string; disabled: boolean; roles: string[];
			show_in_list: boolean | null; seen_at: Date;
		}>(
			`SELECT name, full_name, disabled, roles, show_in_list, seen_at
			   FROM base_users WHERE base_id = $1 ORDER BY name`, [baseId],
		);
		return r.rows.map((x) => ({
			name: x.name, fullName: x.full_name, disabled: x.disabled,
			roles: x.roles ?? [],
			// null остаётся null: «агент не сообщил» — не «выключено». Панель по этому
			// признаку и решает, показывать ли значение как факт или спросить, что записать.
			showInList: x.show_in_list,
			seenAt: x.seen_at.toISOString(),
		}));
	}

	async extensionsOfBase(baseId: string): Promise<(IbExtension & { seenAt: string })[]> {
		const r = await this.db.query<{ name: string; synonym: string | null; version: string | null; purpose: string | null; safe_mode: boolean | null; seen_at: Date }>(
			`SELECT name, synonym, version, purpose, safe_mode, seen_at FROM base_extensions WHERE base_id = $1 ORDER BY name`, [baseId],
		);
		return r.rows.map((x) => ({
			name: x.name, synonym: x.synonym, version: x.version, purpose: x.purpose,
			safeMode: x.safe_mode, seenAt: x.seen_at.toISOString(),
		}));
	}
}
