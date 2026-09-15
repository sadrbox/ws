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
import { parseLock, type ConfigState, type LockState } from "../onec/writeState.ts";

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
	/**
	 * ЕСТЬ ЛИ У БАЗЫ ЕЁ ДАННЫЕ В СУБД — ответ агента, полученный БЕЗ входа в базу.
	 *
	 * Трёхзначно, как и публикация: `true` — регистрация есть, базы данных нет (фантом);
	 * `false` — база данных на месте; поля НЕТ ВОВСЕ — агент ещё не проверял (или ему не
	 * задан пароль СУБД), и это не «всё в порядке»: прежнее знание сохраняется.
	 *
	 * Зачем это в срезе. Раньше фантом обнаруживался только тем, что по нему промахнулись:
	 * признак ставила неудавшаяся команда внутрь базы. На сотне баз это значит, что фантомы
	 * не видны, пока в каждую не постучались, — а вручную такой обход никто не делает.
	 * Теперь агент проверяет базы фоном и присылает ответ вместе со срезом, и кнопка
	 * «Обновить» показывает фантомы сама, не потратив ни одной команды внутрь базы.
	 */
	dbMissing?: boolean | null;
	/** Блокировка начала сеансов, если кластер отдаёт её без входа в базу (E1). Нет — не знаем. */
	lock?: unknown;
};

export type BaseRow = {
	infobase_id: string | null;
	published: boolean | null;
	publish_url: string | null;
	publish_seen_at: Date | null;
	ib_unreachable_at: Date | null;
	ib_unreachable_reason: string | null;
	sessions_denied?: boolean | null;
	sessions_denied_message?: string | null;
	sessions_denied_from?: string | null;
	sessions_denied_to?: string | null;
	sessions_denied_seen_at?: Date | null;
	sessions_denied_source?: string | null;
	sessions_denied_active?: boolean | null;
	sessions_denied_code_set?: boolean | null;
	config_name?: string | null;
	config_version?: string | null;
	config_seen_at?: Date | null;
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
	/** Блокировка начала сеансов (S1): null — не знаем; источник — кластер или команда панели. */
	sessionsDenied: boolean | null;
	sessionsDeniedMessage: string | null;
	sessionsDeniedFrom: string | null;
	sessionsDeniedTo: string | null;
	sessionsDeniedSeenAt: string | null;
	sessionsDeniedSource: "cluster" | "command" | null;
	/** Включена, но действует ли сейчас (агент 23:16); null — не сообщал. */
	sessionsDeniedActive: boolean | null;
	/** Задан ли код разрешения входа в закрытую базу (С26); null — не сообщал. */
	sessionsDeniedCodeSet: boolean | null;
	/** Конфигурация базы (S3); onecVersion — версия платформы, это другое. */
	configName: string | null;
	configVersion: string | null;
	configSeenAt: string | null;
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
	/**
	 * ПОЧЕМУ не войти — кодом (см. миграцию 018 и `ibFailureReason`). «Базы нет в СУБД» и
	 * «не пускают» требуют разных действий, а одинаковое «недоступна» заставляет человека
	 * выяснять это самому — по тексту ошибки, который он уже один раз прочитал и не понял.
	 */
	ibUnreachableReason: IbUnreachableReason | null;
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

/**
 * Настраиваемые параметры сервера 1С. Всё, что здесь есть, человек задаёт сам: агент этого
 * не знает и знать не обязан (публичное имя) либо знает не всегда (адрес RAS).
 */
export type ServerParams = {
	id: string;
	name: string;
	/** Под каким именем сервер виден снаружи — для ссылок на опубликованные базы. */
	publicHost: string | null;
	/** Адрес службы RAS, через которую агент ходит в кластер. */
	rasHost: string | null;
	rasPort: number | null;
	bases: number;
};

/** Одна строка среза публикаций, как её присылает агент (CLUSTER_LIST_PUBLICATIONS). */
/**
 * ПОЧЕМУ в базу не войти — кодом, а не пересказом ошибки.
 *
 * ЗАЧЕМ. Команда внутрь базы отказывает по-разному, и разница решает, что делать дальше.
 * «Занят рабочий каталог» лечится повтором; «базы нет в СУБД» повтором не лечится НИКОГДА,
 * и повторять её — значит каждый раз тратить минуты ожидания на заведомый отказ. Живой
 * случай: `aibek` числится в кластере как ONLINE, а ibcmd отвечает «База данных
 * отсутствует в сервере баз данных. Не найдена база данных 'aibek' в SQL-сервере
 * 'localhost'». Код ошибки при этом общий — IB_ERROR, — поэтому разбираем текст.
 *
 * ПОЧЕМУ ПО ТЕКСТУ. Коды агент даёт крупными мазками (IB_ERROR на всё, что ответила
 * утилита), а различие живёт в сообщении 1С. Разбор намеренно узкий: не узнали — вернём
 * null, и база останется «в порядке». Ошибиться в сторону «всё хорошо» здесь дешевле:
 * ложная отметка «базы нет» исключила бы рабочую базу из всех групповых операций.
 */
export type IbUnreachableReason = "NO_DB" | "NO_INFOBASE" | "NO_ACCESS" | "UNKNOWN";

export function ibFailureReason(
	error?: { code?: string | null; message?: string | null } | null,
): IbUnreachableReason | null {
	if (!error) return null;
	const code = (error.code ?? "").toUpperCase();
	const text = (error.message ?? "").toLowerCase();

	// Агент научился называть это прямо (сборка от 2026-09-12): код означает «в базу войти
	// нельзя и повтор не поможет». Разбор текста ниже остаётся для старых сборок.
	if (code === "IB_DB_MISSING") return "NO_DB";
	// Не пускают — по коду агента, а не по тексту (С6): текст зависит от языка платформы.
	if (code === "IB_AUTH_FAILED") return "NO_ACCESS";
	// Обрыв связи с рабочим процессом кластера (агент 23:52, С15) — не про базу. Разбор текста ниже
	// не применяем: агент дописывает к этому отказу настройки кластера и список процессов, и
	// случайное совпадение слов пометило бы исправную базу «в базу не войти».
	if (code === "IB_CONNECTION_LOST") return null;
	// Занятость и остановка — тоже не про базу (С31, С25): команда не выполнялась или прервана службой.
	if (["IB_BUSY", "AGENT_BUSY", "AGENT_STOPPING", "AGENT_STOPPED", "TIMEOUT", "IB_TIMEOUT"].includes(code)) return null;

	// Нет регистрации в кластере: база исчезла целиком, а не только её данные.
	if (code === "INFOBASE_NOT_FOUND") return "NO_INFOBASE";
	if (/не найдена на сервере|infobase .* not found|информационная база не найдена/.test(text)) {
		return "NO_INFOBASE";
	}

	// Регистрация есть, данных нет: самый частый и самый непонятный для человека случай.
	if (/база данных отсутствует|не найдена база данных|database .* does not exist|cannot open database/.test(text)) {
		return "NO_DB";
	}

	// Не пускают: учётные данные или права. Это чинится настройкой, а не восстановлением.
	if (/идентификация пользователя не выполнена|неверн\w* (логин|пароль|имя пользователя)|доступ запрещ|access denied|authentication failed|недостаточно прав/.test(text)) {
		return "NO_ACCESS";
	}

	return null;
}

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
	b.ib_unreachable_reason,
	b.sessions_denied, b.sessions_denied_message, b.sessions_denied_from, b.sessions_denied_to,
	b.sessions_denied_seen_at, b.sessions_denied_source, b.sessions_denied_active, b.sessions_denied_code_set, b.config_name, b.config_version, b.config_seen_at,
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

	/** Серверы 1С и их настраиваемые параметры — для экрана настроек и карточки агента. */
	async listServers(): Promise<ServerParams[]> {
		const r = await this.db.query<{
			id: string; name: string; public_host: string | null;
			ras_host: string | null; ras_port: number | null; bases: string;
		}>(
			`SELECT s.id, s.name, s.public_host, s.ras_host, s.ras_port, count(b.id) AS bases
			   FROM servers s LEFT JOIN bases b ON b.server_id = s.id
			  GROUP BY s.id ORDER BY s.name`,
		);
		return r.rows.map((x) => ({
			id: x.id, name: x.name, publicHost: x.public_host,
			rasHost: x.ras_host, rasPort: x.ras_port, bases: Number(x.bases),
		}));
	}

	/**
	 * Параметры сервера, которые задаёт человек.
	 *
	 * ПУСТАЯ СТРОКА СТИРАЕТ значение, а НЕ «не меняет»: отказ от подмены адреса или от
	 * своего RAS — такое же решение, как и сама настройка, и выразить его надо уметь.
	 * Отсюда NULLIF, а не COALESCE: «не трогать» выражается тем, что поле не прислали
	 * вовсе (`undefined`), и такие поля до SQL не доходят.
	 */
	async updateServer(serverId: string, p: {
		name?: string; publicHost?: string; rasHost?: string; rasPort?: number | null;
	}): Promise<boolean> {
		const sets: string[] = [];
		const vals: unknown[] = [serverId];
		if (p.name !== undefined && p.name.trim()) { vals.push(p.name.trim()); sets.push(`name = $${vals.length}`); }
		if (p.publicHost !== undefined) { vals.push(p.publicHost.trim()); sets.push(`public_host = NULLIF($${vals.length}, '')`); }
		if (p.rasHost !== undefined) { vals.push(p.rasHost.trim()); sets.push(`ras_host = NULLIF($${vals.length}, '')`); }
		if (p.rasPort !== undefined) { vals.push(p.rasPort); sets.push(`ras_port = $${vals.length}`); }
		if (!sets.length) return true;
		const r = await this.db.query(`UPDATE servers SET ${sets.join(", ")} WHERE id = $1`, vals);
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
		const rows = states
			.map((s) => ({ ...s, key: s.key.trim() }))
			.filter((s) => !!s.key);
		if (rows.length) {
			/*
			 * ОДИН ЗАПРОС НА ВЕСЬ СРЕЗ, а не по запросу на базу.
			 *
			 * Раньше здесь был цикл: сто одиннадцать баз — сто одиннадцать round-trip'ов, и
			 * так на каждый полный срез (heartbeat и кнопка «Обновить»). Семантика при этом
			 * тонкая и её нельзя потерять: «поля нет» значит «агент не знает», а не «пусто»,
			 * — поэтому колонки по-прежнему обновляются через COALESCE, а признаки публикации
			 * и отсутствия базы в СУБД остаются трёхзначными.
			 *
			 * Имя с «?» — след транскодирования через CP1251 на стороне агента: русские буквы
			 * выживают, казахские (ә ғ қ ң ө ұ ү һ і) превращаются в «?» безвозвратно. Таким
			 * именем НЕ затираем уже сохранённое целое — иначе старый агент, запущенный после
			 * исправленного, снова испортит реестр. Признак считается в самом запросе
			 * (position('?' in EXCLUDED.name)), а не приезжает отдельным массивом.
			 */
			await this.db.query(
				`INSERT INTO bases (id, server_id, key, name, status, onec_version, ext_version,
				                    sessions_count, infobase_id, last_seen_at, published, publish_url,
				                    publish_seen_at, ib_unreachable_at, ib_unreachable_reason)
				 SELECT x.id, $1, x.key, COALESCE(x.name, ''), COALESCE(x.status, 'UNKNOWN'),
				        x.onec_version, x.ext_version, x.sessions_count, x.infobase_id, now(),
				        x.published, x.publish_url,
				        CASE WHEN x.published IS NULL THEN NULL ELSE now() END,
				        CASE WHEN x.db_missing IS TRUE THEN now() ELSE NULL END,
				        CASE WHEN x.db_missing IS TRUE THEN 'NO_DB' ELSE NULL END
				   FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
				               $8::integer[], $9::text[], $10::boolean[], $11::text[], $12::boolean[])
				     AS x(id, key, name, status, onec_version, ext_version,
				          sessions_count, infobase_id, published, publish_url, db_missing)
				 ON CONFLICT (server_id, key) DO UPDATE
				    SET name           = CASE
				                           WHEN EXCLUDED.name = '' THEN bases.name
				                           WHEN position('?' in EXCLUDED.name) > 0
				                                AND bases.name <> '' AND position('?' in bases.name) = 0 THEN bases.name
				                           ELSE EXCLUDED.name
				                         END,
				        -- «UNKNOWN» — это «агент не знает» (или не прислал поле вовсе, и мы
				        -- подставили умолчание при вставке): прежнее состояние в обоих случаях
				        -- честнее выдуманного.
				        status         = COALESCE(NULLIF(EXCLUDED.status, 'UNKNOWN'), bases.status),
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
				        -- Признак «нет в СУБД» здесь НЕ трогаем: у него три значения, и в одной
				        -- ветке UPSERT их не выразить, не запутав «поля нет вовсе». Его ставят и
				        -- снимают два коротких запроса ниже — по спискам баз, о которых агент
				        -- сказал определённо.
				        last_seen_at   = now()`,
				[
					serverId,
					rows.map(() => randomUUID()),
					rows.map((s) => s.key),
					rows.map((s) => s.name ?? null),
					rows.map((s) => s.status ?? null),
					rows.map((s) => s.onecVersion ?? null),
					rows.map((s) => s.extVersion ?? null),
					rows.map((s) => s.sessionsCount ?? null),
					rows.map((s) => s.id ?? null),
					/*
					 * ПУБЛИКАЦИЯ ИЗ СРЕЗА БАЗ — ТРЁХЗНАЧНАЯ, и различать состояния обязан агент.
					 * Контракт: нашёл — `true` с адресом; не нашёл ПРИ ПОЛНОМ просмотре
					 * веб-сервера — `false`; не нашёл при неполном — поля нет вовсе, и прежнее
					 * значение сохраняется (COALESCE выше). Проверено на живом сервере: сборка,
					 * которая ещё не умеет различать три состояния, признака не шлёт вовсе и
					 * потому ничего не затирает.
					 */
					rows.map((s) => s.published ?? null),
					rows.map((s) => s.publishUrl ?? null),
					rows.map((s) => s.dbMissing ?? null),
				],
			);
			// Определённые ответы про базу данных в СУБД — общим путём с проверкой по кнопке (S3).
			await this.applyDbPresence(serverId, rows);
			// Блокировка сеансов из среза — только у тех строк, где кластер её сообщил (E1).
			for (const s of rows) {
				const lock = parseLock(s.lock);
				if (lock) await this.setSessionsLock(serverId, s.key, lock, "cluster");
			}
		}

		// Полный срез от того, кто владеет списком (админ-агент), закрывает пропавшие базы.
		if (opts.complete && opts.authoritative) {
			const keys = rows.map((s) => s.key);
			await this.db.query(
				`UPDATE bases SET status = 'MISSING'
				  WHERE server_id = $1 AND NOT (key = ANY($2::text[])) AND status <> 'MISSING'`,
				[serverId, keys],
			);
		}
	}

	/**
	 * Отметки «нет базы данных в СУБД» по определённым ответам агента.
	 *
	 * Общий путь для среза баз (heartbeat, «Обновить из кластера») и для проверки по кнопке
	 * (`CLUSTER_CHECK_BASES`, S3): правила одни, и расходиться им нельзя. Признак ТРЁХЗНАЧНЫЙ:
	 * `true` ставит причину NO_DB, `false` снимает ТОЛЬКО её (агент отвечал про данные в СУБД,
	 * а не про учётные записи), поля нет — база не трогается.
	 */
	async applyDbPresence(serverId: string, items: { key: string; dbMissing?: boolean | null }[]): Promise<void> {
		// Снятие отметки «нет в СУБД» — отдельным запросом: в UPSERT его не выразить,
		// не запутав ветку «поля нет вовсе». Задевает только те базы, что помечены NO_DB,
		// и только те, про которые агент сказал `false`.
		const alive = items.filter((s) => s.dbMissing === false).map((s) => s.key);
		if (alive.length) {
			await this.db.query(
				`UPDATE bases SET ib_unreachable_at = NULL, ib_unreachable_reason = NULL
				  WHERE server_id = $1 AND key = ANY($2::text[]) AND ib_unreachable_reason = 'NO_DB'`,
				[serverId, alive],
			);
		}
		// Положительный ответ ставит причину: в UPSERT она попадает только при вставке.
		const dead = items.filter((s) => s.dbMissing === true).map((s) => s.key);
		if (dead.length) {
			await this.db.query(
				`UPDATE bases
				    SET ib_unreachable_at = COALESCE(ib_unreachable_at, now()), ib_unreachable_reason = 'NO_DB'
				  WHERE server_id = $1 AND key = ANY($2::text[])
				    AND ib_unreachable_reason IS DISTINCT FROM 'NO_DB'`,
				[serverId, dead],
			);
		}
	}

	/**
	 * Применить ответ `CLUSTER_CHECK_BASES` (S3). Не через `sync`: в строках только `key` и
	 * `dbMissing`, а `sync` рассчитан на полный срез и затёр бы остальное знание о базах.
	 * Строки без признака и с мусорным ключом отбрасываются — «проверить не удалось» не факт.
	 */
	async applyCheckResult(serverId: string, result: unknown): Promise<number> {
		const raw = (result as { items?: unknown } | null)?.items;
		if (!Array.isArray(raw)) return 0;
		const answered = raw.flatMap((i) => {
			const o = i as { key?: unknown; dbMissing?: unknown } | null;
			const key = typeof o?.key === "string" ? o.key.trim() : "";
			return key && typeof o?.dbMissing === "boolean" ? [{ key, dbMissing: o.dbMissing }] : [];
		});
		if (answered.length) await this.applyDbPresence(serverId, answered);
		return answered.length;
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
	async markIbReachable(
		serverId: string, key: string, reachable: boolean,
		reason: IbUnreachableReason = "UNKNOWN",
	): Promise<void> {
		if (reachable) {
			await this.db.query(
				`UPDATE bases SET ib_unreachable_at = NULL, ib_unreachable_reason = NULL
				  WHERE server_id = $1 AND key = $2 AND ib_unreachable_at IS NOT NULL`,
				[serverId, key],
			);
			return;
		}
		/*
		 * Время отметки не сдвигаем на каждый повтор — «с какого момента не войти» важнее,
		 * чем «когда пробовали в последний раз». А вот ПРИЧИНУ обновляем всегда: она могла
		 * уточниться (сперва «не пускают», после проверки — «базы нет в СУБД»).
		 */
		await this.db.query(
			`UPDATE bases
			    SET ib_unreachable_at = COALESCE(ib_unreachable_at, now()),
			        ib_unreachable_reason = $3
			  WHERE server_id = $1 AND key = $2
			    AND (ib_unreachable_at IS NULL OR ib_unreachable_reason IS DISTINCT FROM $3)`,
			[serverId, key, reason],
		);
	}

	/**
	 * Состояние публикации по результату команды.
	 *
	 * Отдельно от `sync`: тот бережёт прежние значения (`COALESCE`), потому что «поле не
	 * прислали» значит «не знаю». Здесь ровно наоборот — команда ЗНАЕТ результат, и снятие
	 * публикации обязано СТЕРЕТЬ адрес, а не оставить ссылку на страницу, которой больше нет.
	 */
	async setPublication(serverId: string, key: string, published: boolean, url: string | null, seenAt: string | null = null): Promise<void> {
		await this.db.query(
			`UPDATE bases SET published = $3, publish_url = $4, publish_seen_at = COALESCE($5::timestamptz, now())
			 WHERE server_id = $1 AND key = $2`,
			[serverId, key, published, url, seenAt],
		);
	}

	/**
	 * Блокировка начала сеансов (S1). Прямой UPDATE, как у публикации: команда ЗНАЕТ результат,
	 * и снятие обязано стереть сообщение и окно, а не оставить текст прежней блокировки.
	 */
	async setSessionsLock(serverId: string, key: string, lock: LockState, source: "cluster" | "command"): Promise<void> {
		await this.db.query(
			`UPDATE bases SET sessions_denied = $3, sessions_denied_message = $4, sessions_denied_from = $5,
			        sessions_denied_to = $6, sessions_denied_seen_at = COALESCE($7::timestamptz, now()),
			        sessions_denied_source = $8, sessions_denied_active = $9, sessions_denied_code_set = $10
			  WHERE server_id = $1 AND key = $2`,
			[serverId, key, lock.enabled, lock.enabled ? lock.message : null,
				lock.enabled ? lock.from : null, lock.enabled ? lock.to : null, lock.seenAt, source,
				// «Действует» имеет смысл только у включённой блокировки.
				lock.enabled ? lock.active : null, lock.enabled ? lock.permissionCodeSet : null],
		);
	}

	/**
	 * Регистрацию базы удалили (S2): агент делает это, только убедившись, что базы данных нет, —
	 * значит, в кластере её больше нет. Тот же статус, что ставит полный срез без базы.
	 */
	async markMissing(serverId: string, key: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE bases SET status = 'MISSING' WHERE server_id = $1 AND key = $2 AND status <> 'MISSING'`,
			[serverId, key],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/** Конфигурация базы после загрузки или обновления (S3). Имя без эха не затираем. */
	async setConfig(serverId: string, key: string, config: ConfigState): Promise<void> {
		await this.db.query(
			`UPDATE bases SET config_name = COALESCE($3, config_name), config_version = COALESCE($4, config_version),
			        config_seen_at = COALESCE($5::timestamptz, now())
			  WHERE server_id = $1 AND key = $2`,
			[serverId, key, config.name, config.version, config.seenAt],
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

		/*
		 * СЛОВАРЬ ОДНИМ ЗАПРОСОМ, ЗАПИСЬ — ВТОРЫМ.
		 *
		 * Раньше на каждую строку ответа шли два запроса: поиск базы и запись состояния.
		 * Последний живой срез — 135 строк, то есть 270 round-trip'ов на одно нажатие
		 * «Проверить публикации». Теперь имена читаются разом, а состояние пишется одним
		 * UPDATE ... FROM (unnest).
		 *
		 * Агент называет базу то ключом, то ИМЕНЕМ («Карамурт-Газ ТОО» вместо karamurt_gaz),
		 * поэтому словарь строится по обоим — иначе ответ целиком уходит в никуда, а мы
		 * считаем, что применили его.
		 */
		const known = await this.db.query<{ key: string; name: string }>(
			`SELECT key, name FROM bases WHERE server_id = $1`, [serverId],
		);
		const byLabel = new Map<string, string>();
		for (const b of known.rows) {
			byLabel.set(b.key, b.key);
			if (b.name) byLabel.set(b.name, b.key);
		}

		const keys: string[] = [];
		const flags: boolean[] = [];
		const urls: (string | null)[] = [];
		const seen = new Set<string>();
		for (const it of items) {
			const label = (it.key ?? "").trim();
			if (!label) continue;
			const key = byLabel.get(label);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			keys.push(key);
			// `published !== false` считало опубликованной запись БЕЗ признака вовсе:
			// отсутствие поля — это незнание агента, а не «да». Единственный критерий —
			// isPublished (явное true либо адрес публикации при умолчанном признаке).
			flags.push(isPublished(it));
			urls.push(it.url ?? null);
		}
		const matched = keys.length;
		let marked = 0;
		if (keys.length) {
			const upd = await this.db.query(
				// «Не опубликована» СТИРАЕТ адрес — та же логика, что в setPublication:
				// ссылка на страницу, которой нет, хуже её отсутствия.
				`UPDATE bases b
				    SET published = x.published,
				        publish_url = CASE WHEN x.published THEN x.url ELSE NULL END,
				        publish_seen_at = now()
				   FROM unnest($2::text[], $3::boolean[], $4::text[]) AS x(key, published, url)
				  WHERE b.server_id = $1 AND b.key = x.key`,
				[serverId, keys, flags, urls],
			);
			marked = upd.rowCount ?? 0;
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
			ibUnreachableReason: (r.ib_unreachable_reason as IbUnreachableReason | null) ?? null,
			extensionsCount: r.extensions_count,
			// Имена нужны панели, чтобы отобрать базы БЕЗ нужного расширения: иначе их
			// пришлось бы выискивать глазами среди ста строк.
			extensionNames: r.extension_names ?? [],
			extensionsSeenAt: r.extensions_seen_at?.toISOString() ?? null,
			sessionsCount: r.sessions_count,
			lastSeenAt: r.last_seen_at?.toISOString() ?? null,
			disabled: !!r.disabled_at,
			sessionsDenied: r.sessions_denied ?? null,
			sessionsDeniedMessage: r.sessions_denied_message ?? null,
			sessionsDeniedFrom: r.sessions_denied_from ?? null,
			sessionsDeniedTo: r.sessions_denied_to ?? null,
			sessionsDeniedSeenAt: r.sessions_denied_seen_at?.toISOString() ?? null,
			sessionsDeniedSource: (r.sessions_denied_source as "cluster" | "command" | null | undefined) ?? null,
			sessionsDeniedActive: r.sessions_denied_active ?? null,
			sessionsDeniedCodeSet: r.sessions_denied_code_set ?? null,
			configName: r.config_name ?? null,
			configVersion: r.config_version ?? null,
			configSeenAt: r.config_seen_at?.toISOString() ?? null,
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
