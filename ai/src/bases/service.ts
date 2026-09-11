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
	/** Публикация на веб-сервере: агент сообщает её вместе со срезом баз. */
	published?: boolean | null;
	publishUrl?: string | null;
	/** UUID информационной базы в кластере — им сеансы ссылаются на базу. */
	id?: string;
	name?: string;
	status?: string;
	onecVersion?: string | null;
	extVersion?: string | null;
	sessionsCount?: number;
};

export type BaseRow = {
	infobase_id: string | null;
	published: boolean | null;
	publish_url: string | null;
	publish_seen_at: Date | null;
	ib_unreachable_at: Date | null;
	public_host?: string | null;
	extensions_count: number | null;
	extensions_seen_at: Date | null;
	extension_names: string[] | null;
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
	/** UUID базы в кластере; null — срез ещё не приносил его. */
	infobaseId: string | null;
	/** Публикация на веб-сервере: null — не проверялась, false — точно нет. */
	published: boolean | null;
	publishUrl: string | null;
	/**
	 * Адрес публикации ДЛЯ ПОКАЗА: тот же путь, но под публичным именем сервера, если оно
	 * задано в настройках. Отдельно от `publishUrl`, потому что тот — ответ агента, и
	 * подменять его догадкой значит лишиться возможности заметить ошибку в привязке сайта.
	 */
	publishUrlPublic: string | null;
	/** Когда состояние публикации проверяли в последний раз; null — не проверяли никогда. */
	publishSeenAt: string | null;
	/**
	 * База ЧИСЛИТСЯ в кластере, но войти в неё нельзя: последняя команда внутрь ответила
	 * «база не найдена». Отдельно от `status`, потому что это отдельный факт и знает его
	 * другой источник — тот, который входит в базу, а не перечисляет их (см. миграцию 016).
	 */
	ibUnreachableAt: string | null;
	extensionsCount: number | null;
	extensionsSeenAt: string | null;
	extensionNames: string[];
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

/**
 * Адрес публикации ПОД ПУБЛИЧНЫМ ИМЕНЕМ сервера.
 *
 * Агент собирает адрес из привязки сайта IIS и отдаёт то, что там написано: при привязке
 * без имени узла это `http://localhost/<база>` — с самого сервера ссылка рабочая, снаружи
 * по ней не попасть. Публичное имя задают в настройках сервера, и здесь оно подставляется
 * ТОЛЬКО ДЛЯ ПОКАЗА: исходный ответ агента остаётся нетронутым (см. BaseView.publishUrl),
 * иначе ошибку в самой привязке было бы нечем заметить.
 *
 * Заменяется ровно узел. Схема и порт — из настройки, если она их задаёт («https://1c.x.kz»,
 * «1c.x.kz:8080»), иначе остаются агентские: адрес публикации знает агент, а не мы.
 */
export function publicUrl(url: string | null, publicHost: string | null): string | null {
	if (!url) return null;
	const host = (publicHost ?? "").trim();
	if (!host) return url;
	try {
		const src = new URL(url);
		// Настройку принимаем и голым именем, и с протоколом: человек напишет как привык.
		const cfg = new URL(/^[a-z]+:\/\//i.test(host) ? host : `${src.protocol}//${host}`);
		src.protocol = cfg.protocol;
		src.host = cfg.host;
		return src.toString();
	} catch {
		// Неразбираемая настройка не должна ломать показ: отдаём то, что сказал агент.
		return url;
	}
}

/** Одна строка среза публикаций, как её присылает агент (CLUSTER_LIST_PUBLICATIONS). */
export type PublicationItem = { key: string; name?: string; published?: boolean; url?: string | null };

/**
 * ОПУБЛИКОВАНА ЛИ база по одной строке среза — единственный критерий на весь сервис.
 *
 * Явное `true` — да. Признака нет вовсе, но есть адрес публикации — тоже да: адрес
 * берётся из `default.vrd`, его нельзя получить, не найдя публикацию. Всё остальное,
 * включая отсутствие и признака, и адреса, — НЕ «нет», а незнание агента.
 *
 * Раньше критериев было два и они расходились: отметка ставилась по `published !== false`
 * (то есть запись без признака становилась опубликованной), а список «не снимать» строился
 * по тому же выражению — и запись без признака одновременно попадала в «не трогать» и
 * получала отметку. Теперь правило одно и на обоих путях.
 */
export const isPublished = (i: PublicationItem): boolean =>
	i.published === true || (i.published === undefined && !!i.url);

/**
 * Что вообще пришло в срезе — и можно ли ему верить.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ ПРИМЕНЕНИЯ. Ответ нужен не только реестру, но и человеку: он нажал
 * «Проверить публикации» и обязан узнать, что именно проверка нашла. Раньше панель
 * получала одно число — длину списка — и показывала «Проверено публикаций: 110», хотя
 * найдено было НОЛЬ, а состояние ста десяти баз не изменилось. Число, не отвечающее на
 * заданный вопрос, хуже отсутствия числа.
 *
 * `accepted` — тот же критерий доверия, по которому срез применяется: пока в нём нет ни
 * одной опубликованной базы, веб-сервер без публикаций неотличим от читателя, который не
 * умеет читать (измерено: такой срез затирал состояние, поставленное нашей же командой).
 */
export type PublicationReport = {
	total: number;
	published: number;
	complete: boolean;
	/** Агент сказал, ГДЕ смотрел: имя источника и число просмотренных каталогов. */
	evidence: boolean;
	accepted: boolean;
};

/**
 * `evidence` — чем агент подтверждает, что читал веб-сервер: поля `source` («iis» | «scan»)
 * и `lookedIn` (просмотренные каталоги). Именно они отличают «посмотрел и не нашёл» от
 * «не сумел посмотреть»: сборка агента, которая однажды объявила полным пустой просмотр,
 * этих полей не присылала вовсе.
 */
export const publicationReport = (
	items: PublicationItem[],
	complete: boolean,
	evidence?: { source?: string | null; lookedIn?: number },
): PublicationReport => {
	const published = items.filter(isPublished).length;
	const hasEvidence = !!evidence?.source || (evidence?.lookedIn ?? 0) > 0;
	return {
		total: items.length,
		published,
		complete,
		evidence: hasEvidence,
		/*
		 * Срезу верим, если он что-то НАШЁЛ — либо если агент обещает полноту И говорит,
		 * где смотрел. Второе условие появилось не сразу: сервер, где действительно ничего
		 * не опубликовано, обязан иметь возможность сказать это, но «ничего не нашёл»
		 * без единого доказательства просмотра — та самая поломка, из-за которой сто
		 * десять работающих баз однажды стали «не опубликованными».
		 */
		accepted: published > 0 || (complete && hasEvidence),
	};
};

const BASE_COLS = `b.id, b.server_id, b.key, b.name, b.status, b.onec_version, b.ext_version,
	b.sessions_count, b.last_seen_at, b.disabled_at, b.created_at,
	-- Расширения базы, как их последний раз читали (IB_LIST_EXTENSIONS). Именно счётчик,
	-- а не флаг: колонка «Расширение» показывала «не установлено» всем базам подряд, хотя
	-- на деле мы про них просто НИЧЕГО НЕ ЗНАЛИ — ext_version заполняет только heartbeat
	-- бизнес-агента, и то лишь про своё расширение bpapi.
	b.infobase_id, b.published, b.publish_url, b.publish_seen_at, b.ib_unreachable_at,
	x.n AS extensions_count, x.seen AS extensions_seen_at, x.names AS extension_names`;

/** Подзапрос счётчика расширений: NULL в n означает «базу ещё не проверяли». */
const EXT_JOIN = `LEFT JOIN LATERAL (
	SELECT count(*)::int AS n, max(seen_at) AS seen,
	       coalesce(array_agg(e.name ORDER BY e.name), '{}') AS names
	  FROM base_extensions e WHERE e.base_id = b.id
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
	/**
	 * Переименовать сервер, за которым агент уже закреплён.
	 *
	 * Идентичность сервера — это ЗАКРЕПЛЁННАЯ ЗА АГЕНТОМ строка, а не его имя. Раньше
	 * ключом было имя: агент прислал «SERVER» вместо «Сервер 1С» — и в реестре появился
	 * ВТОРОЙ сервер с теми же 110 базами, то есть каждая база задвоилась в панели.
	 * Имя — атрибут, менять его должно быть безопасно.
	 */
	async renameServer(serverId: string, name: string, ras?: { host?: string | null; port?: number | null }): Promise<ServerRow | null> {
		const r = await this.db.query<ServerRow>(
			`UPDATE servers
			    SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
			        ras_host = COALESCE($3, ras_host),
			        ras_port = COALESCE($4, ras_port)
			  WHERE id = $1
			 RETURNING *`,
			[serverId, name, ras?.host ?? null, ras?.port ?? null],
		);
		return r.rows[0] ?? null;
	}

	/** Серверы 1С с их публичными именами — для экрана настроек. */
	async listServers(): Promise<{ id: string; name: string; publicHost: string | null; bases: number }[]> {
		const r = await this.db.query<{ id: string; name: string; public_host: string | null; bases: string }>(
			`SELECT s.id, s.name, s.public_host, count(b.id) AS bases
			   FROM servers s LEFT JOIN bases b ON b.server_id = s.id
			  GROUP BY s.id ORDER BY s.name`,
		);
		return r.rows.map((x) => ({
			id: x.id, name: x.name, publicHost: x.public_host, bases: Number(x.bases),
		}));
	}

	/**
	 * Публичное имя сервера — под каким он виден снаружи.
	 *
	 * Пустая строка СТИРАЕТ настройку (а не «не меняет»): отказ от подмены — такое же
	 * решение, как и сама подмена, и выразить его человек должен уметь.
	 */
	async setPublicHost(serverId: string, host: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE servers SET public_host = NULLIF($2, '') WHERE id = $1`,
			[serverId, host.trim()],
		);
		return (r.rowCount ?? 0) > 0;
	}

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
				`INSERT INTO bases (id, server_id, key, name, status, onec_version, ext_version, sessions_count, infobase_id, last_seen_at, published, publish_url, publish_seen_at)
				 VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, 'UNKNOWN'), $6, $7, $8, $10, now(), $11, $12,
				         CASE WHEN $11::boolean IS NULL THEN NULL ELSE now() END)
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
				        infobase_id    = COALESCE(EXCLUDED.infobase_id, bases.infobase_id),
				        published      = COALESCE(EXCLUDED.published, bases.published),
				        -- «Не опубликована» СТИРАЕТ адрес: ссылка на страницу, которой нет,
				        -- хуже её отсутствия (та же логика, что в setPublication).
				        publish_url    = CASE WHEN EXCLUDED.published IS FALSE THEN NULL
				                              ELSE COALESCE(EXCLUDED.publish_url, bases.publish_url) END,
				        publish_seen_at = COALESCE(EXCLUDED.publish_seen_at, bases.publish_seen_at),
				        last_seen_at   = now()`,
				[randomUUID(), serverId, key, s.name ?? null, s.status ?? null,
					s.onecVersion ?? null, s.extVersion ?? null, s.sessionsCount ?? null, mangled, s.id ?? null,
					// ПУБЛИКАЦИЯ ИЗ СРЕЗА БАЗ — ТРЁХЗНАЧНАЯ, и различать состояния обязан агент.
					//
					// Контракт: нашёл — `true` с адресом; не нашёл ПРИ ПОЛНОМ просмотре
					// веб-сервера — `false`; не нашёл при неполном — поля нет вовсе, и
					// прежнее значение сохраняется (COALESCE выше).
					//
					// Раньше здесь принималось только положительное: сборка агента присылала
					// `false` там, где на самом деле не сумела прочитать веб-сервер, и
					// очередной срез затирал `true`, поставленный нашей же командой
					// IB_PUBLISH. Защита была верной для ТОГО агента, но у неё была цена:
					// базу, опубликованную мимо панели и потом снятую мимо панели, реестр
					// считал бы опубликованной вечно — отрицательный ответ отбрасывался.
					//
					// Проверено на живом сервере перед снятием защиты: сборка, которая ещё
					// не умеет различать три состояния, признака в срезе баз НЕ ШЛЁТ вовсе
					// (0 записей из 110) — то есть попадает в ветку «не знаю» и ничего не
					// затирает. Различать берёмся только там, где агент сам взялся отвечать.
					s.published ?? null, s.publishUrl ?? null],
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
			`SELECT ${BASE_COLS}, s.name AS server_name, s.public_host
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
			`SELECT ${BASE_COLS}, s.name AS server_name, s.public_host
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  ORDER BY s.name, b.key`,
		);
		return r.rows.map((row) => this.view(row));
	}

	async listByServer(serverId: string): Promise<BaseView[]> {
		const r = await this.db.query<BaseRow & { server_name: string }>(
			`SELECT ${BASE_COLS}, s.name AS server_name, s.public_host
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
			`SELECT ${BASE_COLS}, s.name AS server_name, s.public_host
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
			`SELECT ${BASE_COLS}, s.name AS server_name, s.public_host
			   FROM bases b JOIN servers s ON s.id = b.server_id ${EXT_JOIN}
			  WHERE s.organization_uuid = $1 AND b.key = $2`,
			[organizationUuid, key],
		);
		return r.rows[0] ? this.view(r.rows[0]) : null;
	}

	/**
	 * Пометить базу статусом по факту обращения к ней.
	 *
	 * Список баз приходит из кластера: если `rac` базу перечисляет, она в кластере
	 * зарегистрирована — даже когда самой базы уже нет (снесли на СУБД, а запись в
	 * кластере осталась). Такая база доходит до панели и выглядит рабочей, а любая
	 * команда по ней отвечает «не найдена». Отмечаем это в реестре, чтобы фантом было
	 * видно в списке, а не только в тексте очередной ошибки.
	 */
	async markStatus(serverId: string, key: string, status: string): Promise<void> {
		await this.db.query(
			`UPDATE bases SET status = $3 WHERE server_id = $1 AND key = $2 AND status <> $3`,
			[serverId, key, status],
		);
	}

	/**
	 * «Войти в базу не удалось — её там нет» либо «удалось».
	 *
	 * ПОЧЕМУ НЕ `status`. Его пишет срез кластера, а он отвечает на ДРУГОЙ вопрос: база
	 * зарегистрирована в кластере? Для базы, снесённой на СУБД, ответ честный «да» — запись
	 * есть. Пока оба факта жили в одном поле, срез затирал знание, добытое входом: база
	 * снова выглядела рабочей, человек жал «Обновить», ждал и получал ту же ошибку. Теперь
	 * признак ставит и снимает только тот, кто в базу заходит.
	 */
	async markIbReachable(serverId: string, key: string, reachable: boolean): Promise<void> {
		await this.db.query(
			`UPDATE bases SET ib_unreachable_at = ${reachable ? "NULL" : "now()"}
			  WHERE server_id = $1 AND key = $2
			    AND ib_unreachable_at IS ${reachable ? "NOT NULL" : "NULL"}`,
			[serverId, key],
		);
	}

	/**
	 * Состояние публикации по результату команды.
	 *
	 * Отдельно от `sync`: тот бережёт прежние значения (`COALESCE`), потому что «поле не
	 * прислали» значит «не знаю». Здесь ровно наоборот — команда ЗНАЕТ результат, и снятие
	 * публикации обязано СТЕРЕТЬ адрес, а не оставить ссылку на страницу, которой больше нет.
	 */
	async setPublication(serverId: string, key: string, published: boolean, url: string | null): Promise<void> {
		await this.db.query(
			`UPDATE bases SET published = $3, publish_url = $4, publish_seen_at = now()
			 WHERE server_id = $1 AND key = $2`,
			[serverId, key, published, url],
		);
	}

	/**
	 * Применить срез публикаций с веб-сервера.
	 *
	 * `complete` — обещание агента, что список ПОЛНЫЙ (просмотрены все веб-серверы). Только
	 * тогда отсутствие базы в списке означает «не опубликована»; иначе мы лишь отмечаем
	 * найденное. Разница не теоретическая: агент, видящий один веб-сервер из двух, иначе
	 * объявил бы неопубликованными сотню работающих баз.
	 */
	async applyPublications(
		serverId: string,
		items: PublicationItem[],
		complete: boolean,
		evidence?: { source?: string | null; lookedIn?: number },
	): Promise<{ marked: number; cleared: number; matched: number }> {
		/*
		 * «СПИСОК, В КОТОРОМ НЕТ НИ ОДНОЙ ПУБЛИКАЦИИ» — НЕ ФАКТ, А МОЛЧАНИЕ.
		 *
		 * Веб-сервер, где не опубликовано вообще ничего, снаружи неотличим от читателя,
		 * который не умеет читать. Измерено: сразу после нашей же удачной команды
		 * IB_PUBLISH (агент вернул адрес) следующий «полный» срез не содержал этой базы
		 * вовсе и объявлял неопубликованными все сто девять — то есть затирал то, что мы
		 * только что проверили делом.
		 *
		 * Пока в ответе нет ни одной опубликованной базы, реестр не трогаем вовсе: ни
		 * отметок, ни снятия. Появится хоть одна — значит читатель работает, и его «нет»
		 * чего-то стоит.
		 */
		if (!publicationReport(items, complete, evidence).accepted) return { marked: 0, cleared: 0, matched: 0 };

		let marked = 0;
		let matched = 0;
		for (const it of items) {
			const label = (it.key ?? "").trim();
			if (!label) continue;
			// Агент называет базу то ключом, то ИМЕНЕМ («Карамурт-Газ ТОО» вместо
			// karamurt_gaz). Ищем по обоим: иначе ответ целиком уходит в никуда, а мы
			// считаем, что применили его.
			const hit = await this.db.query<{ key: string }>(
				`SELECT key FROM bases WHERE server_id = $1 AND (key = $2 OR name = $2) LIMIT 1`,
				[serverId, label],
			);
			const key = hit.rows[0]?.key;
			if (!key) continue;
			matched += 1;
			// `published !== false` считало опубликованной запись БЕЗ признака вовсе:
			// отсутствие поля — это незнание агента, а не «да». Единственный критерий —
			// isPublished (явное true либо адрес публикации при умолчанном признаке).
			await this.setPublication(serverId, key, isPublished(it), it.url ?? null);
			marked += 1;
		}
		/*
		 * НИ ОДНА СТРОКА НЕ УЗНАНА — ответ в чужом словаре, и верить ему нельзя.
		 *
		 * Массово проставить «не опубликована» по списку, из которого мы не нашли ни одной
		 * базы, значит выдать собственное непонимание за факт по всем базам сразу. Именно
		 * так сто десять работающих баз однажды стали «не опубликованными».
		 */
		if (!complete || !matched) return { marked, cleared: 0, matched };

		// Список тех, кого снимать НЕЛЬЗЯ, — по тому же критерию, что и отметка выше:
		// иначе запись без признака попадала в «не трогать», но отмечалась как «нет».
		const labels = items.filter(isPublished).map((i) => (i.key ?? "").trim());
		const r = await this.db.query(
			`UPDATE bases SET published = false, publish_url = NULL, publish_seen_at = now()
			  WHERE server_id = $1
			    AND NOT (key = ANY($2::text[])) AND NOT (name = ANY($2::text[]))
			    AND (published IS DISTINCT FROM false)`,
			[serverId, labels],
		);
		return { marked, cleared: r.rowCount ?? 0, matched };
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
			infobaseId: r.infobase_id,
			published: r.published,
			publishUrl: r.publish_url,
			publishUrlPublic: publicUrl(r.publish_url, r.public_host ?? null),
			publishSeenAt: r.publish_seen_at?.toISOString() ?? null,
			ibUnreachableAt: r.ib_unreachable_at?.toISOString() ?? null,
			extensionsCount: r.extensions_count,
			// Имена нужны панели, чтобы отобрать базы БЕЗ нужного расширения: иначе их
			// пришлось бы выискивать глазами среди ста строк.
			extensionNames: r.extension_names ?? [],
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
