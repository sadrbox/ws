// Реестр серверов 1С и их баз (E15/A1).
//
// Модель: организация ERP → серверы 1С → базы. Агент привязан к серверу и имеет роль:
// admin (rac + COM) знает СПИСОК баз, их версию платформы и число сеансов; business
// (расширение bpapi) знает версию расширения в базе. Поэтому один и тот же ряд bases
// заполняют два разных агента, и upsert обновляет только присланное: undefined — «не знаю»,
// а не «затри».
//
// Список баз приходит из heartbeat, а не заводится руками: сто баз никто не будет вносить
// вручную, и любой ручной список разойдётся с кластером в первую же неделю.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

/** Псевдо-база агента старого протокола (v1): у него база одна и она не названа. */
export const DEFAULT_BASE_KEY = "default";

export type BaseState = {
	key: string;
	name?: string;
	status?: string;
	onecVersion?: string | null;
	extVersion?: string | null;
	sessionsCount?: number;
};

export type BaseRow = {
	extensions_count: number | null;
	extensions_seen_at: Date | null;
	id: string;
	server_id: string;
	key: string;
	name: string;
	status: string;
	onec_version: string | null;
	ext_version: string | null;
	sessions_count: number | null;
	last_seen_at: Date | null;
	disabled_at: Date | null;
	created_at: Date;
};

export type BaseView = {
	id: string;
	serverId: string;
	serverName: string;
	key: string;
	name: string;
	status: string;
	onecVersion: string | null;
	extVersion: string | null;
	/** Сколько расширений видели в базе; null — базу ещё ни разу не проверяли. */
	extensionsCount: number | null;
	extensionsSeenAt: string | null;
	sessionsCount: number | null;
	lastSeenAt: string | null;
	disabled: boolean;
};

export type ServerRow = {
	id: string;
	organization_uuid: string;
	name: string;
	ras_host: string | null;
	ras_port: number | null;
	created_at: Date;
};

const BASE_COLS = `b.id, b.server_id, b.key, b.name, b.status, b.onec_version, b.ext_version,
	b.sessions_count, b.last_seen_at, b.disabled_at, b.created_at,
	-- Расширения базы, как их последний раз читали (IB_LIST_EXTENSIONS). Именно счётчик,
	-- а не флаг: колонка «Расширение» показывала «не установлено» всем базам подряд, хотя
	-- на деле мы про них просто НИЧЕГО НЕ ЗНАЛИ — ext_version заполняет только heartbeat
	-- бизнес-агента, и то лишь про своё расширение bpapi.
	x.n AS extensions_count, x.seen AS extensions_seen_at`;

/** Подзапрос счётчика расширений: NULL в n означает «базу ещё не проверяли». */
const EXT_JOIN = `LEFT JOIN LATERAL (
	SELECT count(*)::int AS n, max(seen_at) AS seen FROM base_extensions e WHERE e.base_id = b.id
) x ON true`;

export class BaseService {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	/**
	 * Сервер организации по имени; создаёт, если его ещё нет.
	 *
	 * Имя пустое — это агент, который про сервер ничего не сообщил (протокол v1 или одиночный
	 * стенд). Такой сервер тоже нужен: без него базам не на чем висеть, а маршрутизация
	 * «база → сервер → агент» должна работать одинаково в обоих случаях.
	 */
	async ensureServer(organizationUuid: string, name: string, ras?: { host?: string | null; port?: number | null }): Promise<ServerRow> {
		const r = await this.db.query<ServerRow>(
			`INSERT INTO servers (id, organization_uuid, name, ras_host, ras_port)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (organization_uuid, name) DO UPDATE
			    SET ras_host = COALESCE(EXCLUDED.ras_host, servers.ras_host),
			        ras_port = COALESCE(EXCLUDED.ras_port, servers.ras_port)
			 RETURNING *`,
			[randomUUID(), organizationUuid, name, ras?.host ?? null, ras?.port ?? null],
		);
		return r.rows[0];
	}

	/**
	 * Состояния баз из register/heartbeat. Обновляет только те поля, которые агент прислал.
	 *
	 * Базы НЕ удаляются, даже когда админ-агент прислал полный срез без них: пропавшая база —
	 * это чаще всего временно недоступный кластер, а не удалённая база, и терять историю команд
	 * из-за сетевого сбоя нельзя. Отсутствующие в полном срезе помечаются статусом MISSING —
	 * это видно в панели и не мешает вернуть базу обратно.
	 */
	async sync(serverId: string, states: BaseState[], opts: { complete: boolean; authoritative: boolean }): Promise<void> {
		for (const s of states) {
			const key = s.key.trim();
			if (!key) continue;
			// Имя с «?» — след транскодирования через CP1251 на стороне агента: русские
			// буквы выживают, казахские (ә ғ қ ң ө ұ ү һ і) превращаются в «?» безвозвратно.
			// Таким именем НЕ затираем уже сохранённое целое: иначе старый агент, запущенный
			// после исправленного, снова испортит реестр. Битое имя принимается только
			// когда своего ещё нет.
			const mangled = !!s.name && s.name.includes("?");
			await this.db.query(
				`INSERT INTO bases (id, server_id, key, name, status, onec_version, ext_version, sessions_count, last_seen_at)
				 VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, 'UNKNOWN'), $6, $7, $8, now())
				 ON CONFLICT (server_id, key) DO UPDATE
				    SET name           = CASE
				                           WHEN EXCLUDED.name = '' THEN bases.name
				                           WHEN $9::boolean AND bases.name <> '' AND position('?' in bases.name) = 0 THEN bases.name
				                           ELSE EXCLUDED.name
				                         END,
				        status         = COALESCE($5, bases.status),
				        onec_version   = COALESCE(EXCLUDED.onec_version, bases.onec_version),
				        ext_version    = COALESCE(EXCLUDED.ext_version, bases.ext_version),
				        sessions_count = COALESCE(EXCLUDED.sessions_count, bases.sessions_count),
				        last_seen_at   = now()`,
				[randomUUID(), serverId, key, s.name ?? null, s.status ?? null,
					s.onecVersion ?? null, s.extVersion ?? null, s.sessionsCount ?? null, mangled],
			);
		}

		// Полный срез от того, кто владеет списком (админ-агент), закрывает пропавшие базы.
		if (opts.complete && opts.authoritative) {
			const keys = states.map((s) => s.key.trim()).filter(Boolean);
			await this.db.query(
				`UPDATE bases SET status = 'MISSING'
				  WHERE server_id = $1 AND NOT (key = ANY($2::text[])) AND status <> 'MISSING'`,
				[serverId, keys],
			);
		}
	}

	async listByOrganization(organizationUuid: string): Promise<BaseView[]> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  WHERE s.organization_uuid = $1
			  ORDER BY s.name, b.key`,
			[organizationUuid],
		);
		return r.rows.map((row) => this.view(row));
	}

	/** Все базы всех серверов — реестр администрирования 1С (вне организаций ERP). */
	async listAll(): Promise<BaseView[]> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  ORDER BY s.name, b.key`,
		);
		return r.rows.map((row) => this.view(row));
	}

	async listByServer(serverId: string): Promise<BaseView[]> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  WHERE b.server_id = $1 ORDER BY b.key`,
			[serverId],
		);
		return r.rows.map((row) => this.view(row));
	}

	/**
	 * База по ключу без привязки к организации — администрирование 1С идёт вне
	 * организаций ERP (см. onecRouter). Имя базы уникально в пределах сервера, поэтому
	 * при совпадении ключей на разных серверах вернётся первая; для адресных операций
	 * этого достаточно — исполнитель всё равно выбирается по серверу базы.
	 */
	async findByKeyGlobal(key: string): Promise<BaseView | null> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  WHERE b.key = $1 AND b.disabled_at IS NULL
			  ORDER BY s.name LIMIT 1`,
			[key],
		);
		return r.rows[0] ? this.view(r.rows[0]) : null;
	}

	/** База организации по ключу — точка входа маршрутизации «база → сервер → агент». */
	async findByKey(organizationUuid: string, key: string): Promise<BaseView | null> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  WHERE s.organization_uuid = $1 AND b.key = $2`,
			[organizationUuid, key],
		);
		return r.rows[0] ? this.view(r.rows[0]) : null;
	}

	async setDisabled(id: string, disabled: boolean): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE bases SET disabled_at = ${disabled ? "now()" : "NULL"} WHERE id = $1`,
			[id],
		);
		return (r.rowCount ?? 0) > 0;
	}

	private view(r: BaseRow & { server_name?: string }): BaseView {
		return {
			id: r.id,
			serverId: r.server_id,
			serverName: r.server_name ?? "",
			key: r.key,
			name: r.name,
			status: r.disabled_at ? "DISABLED" : r.status,
			onecVersion: r.onec_version,
			extVersion: r.ext_version,
			extensionsCount: r.extensions_count,
			extensionsSeenAt: r.extensions_seen_at?.toISOString() ?? null,
			sessionsCount: r.sessions_count,
			lastSeenAt: r.last_seen_at?.toISOString() ?? null,
			disabled: !!r.disabled_at,
		};
	}
}

/**
 * Пора ли требовать от агента полный срез по базам.
 *
 * Троттлинг из ТЗ (A2): агент шлёт полный список раз в N минут, между ними — только дельты.
 * Решение принимает сервер, а не агент: так интервал меняется без переустановки службы на
 * сервере 1С, а после перезапуска сервиса полный срез запрашивается сразу.
 */
export function needsFullBases(lastFullAt: Date | null, everySecs: number, now = Date.now()): boolean {
	if (!lastFullAt) return true;
	return now - lastFullAt.getTime() >= everySecs * 1000;
}
