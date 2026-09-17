// Административные команды кластера 1С (E15/A3) — закрытый список.
//
// ЧЕМ ОТЛИЧАЮТСЯ ОТ БИЗНЕС-КОМАНД. Бизнес-команда идёт в базу через расширение bpapi и
// оперирует документами. Административная идёт мимо базы — через `rac` к службе RAS — и
// оперирует кластером: список ИБ, сеансы, соединения, блокировка входа. Вход в базу для
// этого не нужен, нужен администратор кластера. Поэтому исполняет их ДРУГОЙ агент
// (role=admin, отдельная служба под своей учёткой ОС), и путать эти два пути нельзя.
//
// ГЕЙТ (A6). Команда ставится только агенту, который сам объявил нужную способность в
// register.capabilities. Проверка здесь, до постановки в очередь: агент и так отвергнет
// незнакомую команду, но тогда пользователь узнает об этом через минуту таймаута вместо
// внятного отказа сразу.
//
// КЛАССЫ (§17). READ выполняется сразу; CRITICAL всегда проходит через карточку
// подтверждения — снятие сеанса и блокировка входа необратимы для того, кто в этот момент
// работает в базе.

import { z } from "zod";
import type { OperationClass } from "../tools/registry.ts";
import type { AgentRole, AgentView } from "../agents/service.ts";

/**
 * Способности агента, которые проверяет сервис.
 *
 * `cluster.admin` — кластер через rac, `ib.admin` — вход внутрь баз (COM/ibcmd),
 * `agent.procs` — работа со СВОИМИ процессами на сервере 1С (список и снятие). Последняя
 * не про 1С вовсе: это его собственные rac/ibcmd/конфигуратор, которые он запустил и
 * которые переживают команду.
 */
/**
 * `agent.cancel` — прервать НАЧАТУЮ команду (S4). Отдельно от `agent.procs`: его объявляют
 * сборки с 11.09, а команды отмены у них нет; сборки с 12.09 23:48 по 13.09 12:12 объявляют
 * `AGENT_CANCEL_COMMAND`, но у них отмена не доходит до агента, чьи пропуски заняты зависшими
 * командами. Способность объявляет сборка 13.09 14:58 и новее.
 */
export type AgentCapability = "cluster.admin" | "ib.admin" | "agent.procs" | "agent.cancel";

/**
 * Сколько живёт команда в очереди, если спецификация молчит. Пятнадцати минут хватает
 * всему, кроме операций над самой базой — им срок задаётся в спецификации явно.
 */
export const DEFAULT_COMMAND_TTL_SECS = 900;

/**
 * Срок для ДОЛГИХ операций: выгрузка, загрузка, проверка, обновление конфигурации.
 *
 * Четыре часа — столько же даёт им сам агент (`long_command_timeout_secs`), плюс запас на
 * ожидание в очереди. Раньше все команды жили 15 минут, и выгрузка базы на сотню гигабайт
 * объявлялась просроченной ПОСРЕДИ работы: человек получал «служба 1С-агента не на связи»
 * и шёл чинить связь, пока база выгружалась. Результат при этом не терялся (его принимают
 * и у просроченной команды), но приходил уже после приговора.
 */
export const LONG_COMMAND_TTL_SECS = 15_000;

export type AdminCommandSpec = {
	type: string;
	operation: OperationClass;
	capability: AgentCapability;
	role: AgentRole;
	/** Нужна ли конкретная база: для неё выбирается агент того сервера, где она живёт. */
	requiresBase: boolean;
	/** Срок жизни команды в очереди; без него — DEFAULT_COMMAND_TTL_SECS. */
	ttlSeconds?: number;
	schema: z.ZodType<Record<string, unknown>>;
	/** Короткое описание для карточки подтверждения и аудита. */
	title: string;
	/**
	 * Ключ склейки ЧТЕНИЙ, когда адресат — не одна база. По умолчанию одинаковые чтения
	 * склеиваются по `baseKey`; у команды без базы это «-» на всех, и проверка одной базы
	 * отдала бы ответ проверке всех. Такая команда называет свой ключ сама.
	 */
	readKey?: (payload: Record<string, unknown>) => string;
};

const baseKey = z.string().min(1).max(200);
// Имя пользователя ИБ и имя расширения — то, чем 1С их адресует.
// Пустое имя и имя из одних пробелов не принимаются (П19): 1С такое имя не адресует, а панель показала бы «—».
const ibName = z.string().trim().min(1, "не может быть пустым").max(200);

/**
 * СПИСОК РОЛЕЙ БАЗЫ.
 *
 * Предел здесь отвечает не на вопрос «сколько ролей бывает у человека», а на вопрос
 * «сколько их всего в конфигурации»: отметка «выбрать все» в панели шлёт весь список.
 * В типовой «Бухгалтерии» ролей под две сотни, в «ERP» — за полторы тысячи, а прежние сто
 * отвергали обычную операцию «выдать всё» — причём отвечали на неё так, что понять было
 * нечего: «addRoles: Too big: expected array to have <=100 items».
 *
 * Ограничение остаётся, но как защита от бессмысленно большого тела команды, а не от
 * штатной работы: две тысячи ролей — это больше, чем есть в любой известной конфигурации.
 */
const roleList = z.array(z.string().max(200)).max(2000);

/**
 * Короткий отпечаток строки — для ключа склейки. Список из тысячи баз целиком в `request_id`
 * не кладём: колонка стоит под уникальным индексом, а у строки btree-индекса есть предел.
 * Криптостойкость не нужна — нужна устойчивость: один и тот же набор даёт один и тот же ключ.
 */
const fingerprint = (s: string): string => {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export const ADMIN_COMMANDS: AdminCommandSpec[] = [
	{
		type: "CLUSTER_LIST_INFOBASES",
		title: "Список баз кластера",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		schema: z.object({}).strict(),
	},
	{
		type: "CLUSTER_LIST_SESSIONS",
		title: "Сеансы",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Без baseKey — сеансы всего кластера; с ним — только этой базы.
		schema: z.object({ baseKey: baseKey.optional() }).strict(),
	},
	{
		type: "CLUSTER_LIST_CONNECTIONS",
		title: "Соединения",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		schema: z.object({ baseKey: baseKey.optional() }).strict(),
	},
	{
		type: "CLUSTER_INFOBASE_INFO",
		title: "Сведения о базе",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "CLUSTER_TERMINATE_SESSION",
		title: "Снять сеанс",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Сеанс адресуется своим идентификатором кластера; baseKey нужен только для маршрутизации
		// к нужному серверу и для записи в аудит.
		// Идентификатор сеанса кластера — UUID (С27): иное `rac` всё равно не примет, а отказ по схеме понятнее.
		schema: z.object({
			sessionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "идентификатор сеанса кластера — UUID"),
			baseKey: baseKey.optional(),
		}).strict(),
	},
	{
		type: "CLUSTER_LIST_LOCKS",
		title: "Блокировки",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// «База висит» почти всегда означает блокировку. Без этого списка снятие сеанса —
		// действие наугад: не видно, кто кого держит.
		schema: z.object({ baseKey: baseKey.optional() }).strict(),
	},
	{
		type: "CLUSTER_LIST_PROCESSES",
		title: "Рабочие процессы",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		schema: z.object({}).strict(),
	},
	{
		type: "CLUSTER_LIST_LICENSES",
		title: "Лицензии",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Отказы при одновременных подключениях упирались в лицензии, а увидеть их было
		// нечем: кто держит лицензию — единственный способ это понять.
		schema: z.object({}).strict(),
	},
	{
		type: "CLUSTER_DISCONNECT",
		title: "Разорвать соединение",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Соединение адресуется UUID (как и сеанс — номер rac не принимает).
		schema: z.object({ connectionId: z.string().min(1).max(64), baseKey: baseKey.optional() }).strict(),
	},

	// ── Внутрибазовые операции (A3-P1). Идут НЕ через rac: агенту нужно войти в базу
	// (COM-соединение или расширение), поэтому отдельная способность ib.admin и
	// служебный администратор ИБ в каждой базе. Роль та же — admin.
	{
		type: "IB_LIST_USERS",
		title: "Пользователи базы",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_CREATE_USER",
		title: "Создать пользователя базы",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			name: ibName,
			// Полное имя не очищается пустой строкой (П19, решение 15.09): поле есть — значит, непустое.
			fullName: z.string().trim().min(1, "не может быть пустым").max(200).optional(),
			// Пароль не логируется и не возвращается; пустой — вход без пароля (как в 1С).
			password: z.string().max(200).optional(),
			roles: roleList.optional(),
			// Аутентификация ОС и признак «показывать в списке выбора».
			osUser: z.string().max(200).optional(),
			showInList: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "AGENT_LIST_PROCESSES",
		title: "Процессы, запущенные агентом",
		operation: "READ",
		capability: "agent.procs",
		role: "admin",
		requiresBase: false,
		// Список приходит и с heartbeat раз в полминуты; эта команда нужна кнопке
		// «Обновить сейчас» — когда человек смотрит на зависший процесс и ждёт от него
		// движения, полминуты слишком долго.
		schema: z.object({}).strict(),
	},
	{
		type: "AGENT_KILL_PROCESS",
		title: "Снять процесс агента",
		operation: "CRITICAL",
		capability: "agent.procs",
		role: "admin",
		requiresBase: false,
		/**
		 * `force` — согласие снять КОНФИГУРАТОР. Без него агент его не тронет и ответит
		 * AGENT_PROCESS_UNSAFE: обрыв применения конфигурации оставит базу непригодной, а
		 * обрыв выгрузки — обрезанный .dt. Решение принимает человек, а не интерфейс.
		 *
		 * Снять можно только процесс, который агент запускал сам: номер сверяется с его
		 * списком (AGENT_PROCESS_NOT_FOUND). Иначе опечатка в номере остановила бы рабочий
		 * rphost вместе с сеансами пользователей.
		 */
		schema: z.object({
			pid: z.number().int().positive(),
			force: z.boolean().optional(),
		}).strict(),
	},
	{
		/*
		 * СОСТОЯНИЕ СЕРВЕРА 1С (R1, docs/TASKS_DEV_2026-09-14.md): сборка, готовность, кластер,
		 * процессы, последние ошибки журнала. Исполняет служба агента, пропуска на исполнение не
		 * ждёт — отвечает и тогда, когда все места заняты. Адресуется КОНКРЕТНОМУ агенту
		 * (маршрут `/agents/:id/health`); склейка одинаковых чтений — в пределах агента
		 * (уникальный индекс очереди — по агенту).
		 */
		type: "AGENT_HEALTH",
		title: "Состояние сервера 1С",
		operation: "READ",
		capability: "agent.procs",
		role: "admin",
		requiresBase: false,
		schema: z.object({}).strict(),
	},
	{
		/*
		 * ХВОСТ ЖУРНАЛА АГЕНТА (R2). Пароли и токены агент вырезает ДО отбора по тексту. Чтения с
		 * разными параметрами — разные ответы, поэтому ключ склейки включает параметры.
		 */
		type: "AGENT_LOG_TAIL",
		title: "Журнал агента",
		operation: "READ",
		capability: "agent.procs",
		role: "admin",
		requiresBase: false,
		schema: z.object({
			lines: z.number().int().min(1).max(1000).optional(),
			level: z.enum(["all", "problems"]).optional(),
			contains: z.string().max(100).optional(),
		}).strict(),
		readKey: (p) => `${p.lines ?? 200}:${p.level ?? "all"}:${typeof p.contains === "string" ? p.contains : ""}`,
	},
	{
		/*
		 * САМОПРОВЕРКА ОПЕРАЦИЙ В БАЗЕ (R4). Создаёт и удаляет временного пользователя
		 * `bpapi_selftest_<процесс>` — поэтому WRITE и только полному доступу. Реестр не трогает:
		 * пользователь временный, эхо внутри прогона сервису не уходит. Неудачный шаг — не отказ,
		 * а `ok: false` в ответе.
		 */
		type: "IB_SELFTEST",
		title: "Проверить операции агента в базе",
		operation: "WRITE",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_LIST_ROLES",
		title: "Роли конфигурации базы",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Набор ролей задаёт КОНФИГУРАЦИЯ, а не пользователь: у «Бухгалтерии» и «Зарплаты»
		// он разный. Поэтому список берётся у базы, а не из общего справочника.
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_UPDATE_USER",
		title: "Изменить пользователя базы",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Изменение, а не пересоздание: пересоздать пользователя нельзя без потери его
		// настроек и ссылок в базе, а «удалить и создать заново» на сотне баз — это ещё и
		// сотня шансов остановиться на середине.
		//
		// Незаполненное поле означает «не трогать», а НЕ «очистить»: групповое изменение
		// полного имени не должно заодно стирать всем пароли.
		schema: z.object({
			baseKey,
			name: ibName,
			/** Новое имя входа; без него имя не меняется. */
			newName: ibName.optional(),
			// Полное имя не очищается пустой строкой (П19, решение 15.09): поле есть — значит, непустое.
			fullName: z.string().trim().min(1, "не может быть пустым").max(200).optional(),
			password: z.string().max(200).optional(),
			/**
			 * ТРИ РАЗНЫХ СПОСОБА тронуть роли — и путать их нельзя.
			 *
			 * `addRoles` / `removeRoles` меняют набор ОТНОСИТЕЛЬНО того, что есть в КАЖДОЙ
			 * базе: добавить одну роль десяти базам, где наборы разные, можно только так.
			 * `roles` задаёт набор целиком и стирает всё остальное — это отдельная операция
			 * «привести к эталону», а не «выдать роль».
			 *
			 * Панель до этого считала итоговый набор по ПЕРВОЙ базе и слала его во все:
			 * базы с другими наборами молча выравнивались по первой. Разница между
			 * «добавить» и «заменить» существует ровно для того, чтобы этого не случалось.
			 */
			addRoles: roleList.optional(),
			removeRoles: roleList.optional(),
			roles: roleList.optional(),
			disabled: z.boolean().optional(),
			showInList: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_DELETE_USER",
		title: "Удалить пользователя базы",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey, name: ibName }).strict(),
	},
	{
		type: "IB_LIST_EXTENSIONS",
		title: "Расширения базы",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		/*
		 * СВЕДЕНИЯ О БАЗЕ (С35, агент 23:24). Только чтение и только по запросу — фонового чтения нет: версия
		 * конфигурации меняется загрузкой и обновлением, а там она приходит в эхе. Одним входом — конфигурация и
		 * расширения; блокировка и регистрация — из `rac`. Ответ применяется тем же разбором, что эхо
		 * (`planWriteState`, `parseEcho`).
		 */
		type: "IB_INFO",
		title: "Сведения о базе",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_INSTALL_EXTENSION",
		title: "Установить расширение",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Файл .cfe передаётся телом команды: агент не ходит за ним в сеть.
		schema: z.object({
			baseKey,
			name: ibName,
			contentBase64: z.string().min(1),
			safeMode: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_PUBLISH",
		title: "Опубликовать базу на веб-сервере",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Публикация — НЕ операция над базой: это настройка веб-сервера (виртуальный каталог
		// + default.vrd), в скриптовом API 1С её нет. Агент делает её запуском webinst,
		// ровно как запускает rac. Здесь она потому, что адресуется базой и нужна ровно для
		// того, чтобы у базы появился HTTP-канал вместо медленного COM.
		schema: z.object({
			baseKey,
			// Всё необязательно: агент подставляет свои умолчания (alias = имя базы).
			alias: z.string().max(200).optional(),
			dir: z.string().max(500).optional(),
			// apache22 агент умеет наравне с apache24 (С14).
			webServer: z.enum(["iis", "apache22", "apache24"]).optional(),
		}).strict(),
	},
	{
		type: "IB_BACKUP",
		ttlSeconds: LONG_COMMAND_TTL_SECS,
		title: "Выгрузить базу (.dt)",
		// CRITICAL не из-за риска для данных — выгрузка ничего не портит, — а из-за цены:
		// на сотне баз это часы работы сервера и десятки гигабайт на диске. Такое
		// запускают осознанно, а не случайным нажатием.
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			// Каталог назначения; без него агент берёт свой из настроек. Панель не должна
			// знать раскладку дисков сервера 1С — это его дело.
			dir: z.string().max(500).optional(),
		}).strict(),
	},
	{
		type: "IB_CHECK",
		ttlSeconds: LONG_COMMAND_TTL_SECS,
		title: "Проверить базу",
		/**
		 * WRITE, а не CRITICAL: без `repair` команда ничего не меняет — смотрит и считает.
		 * Само исправление подтверждается ОТДЕЛЬНО в интерфейсе, флагом `repair`. Если
		 * подтверждать всю проверку целиком, человек привыкнет подтверждать её не читая —
		 * и однажды подтвердит исправление, думая, что подтверждает осмотр.
		 */
		operation: "WRITE",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			// Без `repair` агент только осматривает (`-LogAndRefsIntegrity -TestOnly`): переиндексации и
			// пересчёта итогов нет, они приходят в `skipped`, а логическая целостность проверяется всегда.
			// С `repair` — выбранное плюс восстановление созданием объектов (С28, агент 22:05).
			reindex: z.boolean().optional(),
			logicalIntegrity: z.boolean().optional(),
			recalcTotals: z.boolean().optional(),
			/** Чинить, а не только смотреть: это уже изменение данных. */
			repair: z.boolean().optional(),
			/** Вернуть план и не трогать базу — готовый текст подтверждения. */
			dryRun: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_RESTORE",
		ttlSeconds: LONG_COMMAND_TTL_SECS,
		title: "Загрузить базу из выгрузки (.dt)",
		// Единственная команда, которая ЗАТИРАЕТ данные целиком. Подтверждение обязано
		// называть и базу, и файл: перепутать можно и то, и другое.
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			/** Файл на сервере 1С. Панель его не проверяет — несуществующий отвергнет агент. */
			path: z.string().min(1).max(500),
			/** Заблокировать вход и дождаться выхода пользователей; снимает блокировку агент сам. */
			lockSessions: z.boolean().optional(),
			dryRun: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_APPLY_UPDATE",
		ttlSeconds: LONG_COMMAND_TTL_SECS,
		title: "Обновить конфигурацию базы (.cfu/.cf)",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			path: z.string().min(1).max(500),
			/**
			 * Выгрузка перед обновлением. `false` означает «откатывать будет нечем»: агент
			 * скажет это в ошибке, но уже после того, как обновление не удалось.
			 */
			backup: z.boolean().optional(),
			lockSessions: z.boolean().optional(),
			dryRun: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "CLUSTER_LIST_PUBLICATIONS",
		title: "Список публикаций на веб-сервере",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Публикации читаются с веб-сервера (каталоги + default.vrd/web.config), а не из
		// кластера, поэтому базу команда не адресует: спрашиваем сразу все.
		schema: z.object({}).strict(),
	},
	{
		type: "IB_UNPUBLISH",
		title: "Снять публикацию базы с веб-сервера",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Обратная IB_PUBLISH: удаление виртуального каталога и записи о базе с веб-сервера.
		// CRITICAL не из-за данных (база не страдает), а из-за людей: у всех, кто работает
		// через веб-клиент или тонкий клиент по HTTP, доступ пропадает немедленно.
		schema: z.object({
			baseKey,
			alias: z.string().max(200).optional(),
			// apache22 агент умеет наравне с apache24 (С14).
			webServer: z.enum(["iis", "apache22", "apache24"]).optional(),
		}).strict(),
	},
	{
		type: "IB_DELETE_EXTENSION",
		title: "Удалить расширение",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey, name: ibName }).strict(),
	},
	{
		type: "CLUSTER_DROP_INFOBASE",
		title: "Удалить регистрацию базы из кластера",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		/*
		 * УДАЛЯЕТСЯ ЗАПИСЬ В КЛАСТЕРЕ, А НЕ ДАННЫЕ.
		 *
		 * Регистрация переживает свою базу данных: `rac` перечисляет базу, которой на СУБД
		 * уже нет, панель показывает её наравне с рабочими, а каждое обращение внутрь
		 * отвечает «База данных отсутствует в сервере баз данных». Убрать такую запись можно
		 * было только руками на сервере — и потому не убирали.
		 *
		 * Ключи `--drop-database` / `--clear-database` агент не передаёт НИКОГДА, и перед
		 * удалением сам проверяет через СУБД, что базы данных действительно нет: у живой
		 * базы команда отказывает («база РАБОТАЕТ»), и «не смог убедиться» тоже отказ, а не
		 * молчаливое удаление (см. docs/TASK_SERVICE_DROP_INFOBASE.md).
		 *
		 * `confirm` обязателен и обязан быть `true`: восстановить запись можно только
		 * вручную, со всеми параметрами подключения, — цена опечатки в имени слишком высока,
		 * чтобы полагаться на умолчание.
		 */
		schema: z.object({
			baseKey,
			confirm: z.literal(true),
		}).strict(),
	},
	{
		type: "CLUSTER_CHECK_BASES",
		title: "Проверить наличие баз данных",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		/*
		 * ПАРА К УДАЛЕНИЮ РЕГИСТРАЦИИ (S3). Фоновая проверка агента узнаёт о базе без базы
		 * данных за сутки; эта — за минуту на сотне баз, одним запросом к СУБД. Пустой список
		 * — все базы кластера. Ответ `{ items: [{ key, dbMissing?, reason?, byQuery? }], checked, skipped, note }`
		 * (`reason` — почему не проверена, `byQuery` — решено запросом к СУБД, а не входом; С28):
		 * поля `dbMissing` нет — проверить не удалось, и прежнее знание не трогаем. Применяется
		 * при приёме результата (agentRouter), а не в HTTP-обработчике: проверка всех баз
		 * дольше ONEC_COMMAND_TIMEOUT_SECS, и панель получает 202 раньше, чем придёт ответ.
		 */
		schema: z.object({ baseKeys: z.array(baseKey).max(1000).optional() }).strict(),
		// Проверка одной базы и проверка всех — разные вопросы, склеивать их нельзя.
		readKey: (p) => {
			const keys = Array.isArray(p.baseKeys) ? [...new Set(p.baseKeys as string[])].sort() : [];
			return keys.length ? `keys:${keys.length}:${fingerprint(keys.join("\n"))}` : "all";
		},
	},
	{
		type: "AGENT_CANCEL_COMMAND",
		title: "Прервать выполняемую команду",
		operation: "CRITICAL",
		capability: "agent.cancel",
		role: "admin",
		requiresBase: false,
		/*
		 * НАСТОЯЩАЯ ОТМЕНА ВМЕСТО «ПЕРЕСТАЛИ ЖДАТЬ» (S4). Зависшая команда держит место
		 * внутрибазовых операций агента, и вся очередь по всем базам стоит до её срока.
		 * Ответ `{ ok: true, killed, note }` либо `{ ok: false, reason: "NOT_RUNNING" }` —
		 * команда успела закончиться сама. Результат прерванной команды агент НЕ шлёт: её
		 * закрывает сервис (queue.abort). Прерывать разрешено только чтения — это решает
		 * маршрут, а не агент: обрыв выгрузки, загрузки или обновления оставляет базу в
		 * промежуточном состоянии. Базы у команды нет — слот внутрибазовых она не ждёт.
		 */
		schema: z.object({
			commandId: z.string().min(1).max(64),
			force: z.boolean().optional(),
		}).strict(),
	},
	{
		/*
		 * ЗАПРЕТ РЕГЛАМЕНТНЫХ И ФОНОВЫХ ЗАДАНИЙ (агент `2026-09-16 12:13`, С39).
		 *
		 * Поле называется `denied`, а не `enabled`: у блокировки сеансов `enabled: true` значит «вход закрыт», и
		 * одинаковое имя с обратным смыслом в соседних командах — готовая ошибка на живой базе.
		 */
		type: "CLUSTER_SET_SCHEDULED_JOBS",
		title: "Запрет регламентных заданий",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey, denied: z.boolean() }).strict(),
	},
	{
		type: "CLUSTER_SET_SESSIONS_LOCK",
		title: "Блокировка начала сеансов",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			enabled: z.boolean(),
			// Текст, который увидит пользователь при попытке войти, и окно блокировки.
			message: z.string().max(500).optional(),
			from: z.string().max(40).optional(),
			to: z.string().max(40).optional(),
			// Код разрешения: с ним можно войти в заблокированную базу (обслуживание).
			permissionCode: z.string().max(64).optional(),
		}).strict(),
	},
];

const BY_TYPE = new Map(ADMIN_COMMANDS.map((c) => [c.type, c]));

export function findAdminCommand(type: string): AdminCommandSpec | null {
	return BY_TYPE.get(type.toUpperCase()) ?? null;
}

export function isAdminCommand(type: string): boolean {
	return BY_TYPE.has(type.toUpperCase());
}

/**
 * Умеет ли агент выполнить команду. Способности объявляет сам агент при регистрации —
 * сервис им верит: способность не даёт прав, она лишь говорит, что служба умеет и настроена
 * (есть путь к `rac`, заданы адрес RAS и администратор кластера). Настоящее ограничение —
 * права учётной записи ОС, под которой служба работает.
 */
export function agentCanRun(agent: Pick<AgentView, "role" | "capabilities">, spec: AdminCommandSpec): boolean {
	if (agent.role !== spec.role || !agent.capabilities.includes(spec.capability)) return false;

	// Агент перечисляет не только способности (`cluster.admin`), но и КОНКРЕТНЫЕ типы
	// команд, которые умеет. Если такой перечень есть — проверяем по нему: иначе команда,
	// добавленная в сервисе раньше, чем в агенте, уходит в очередь и возвращается через
	// сеть с «тип команды не поддерживается». Отказать сразу и сказать, что агент устарел,
	// полезнее, чем round-trip ради того же вывода.
	const declaresTypes = agent.capabilities.some((c) => /^[A-Z][A-Z0-9_]+$/.test(c));
	return declaresTypes ? agent.capabilities.includes(spec.type) : true;
}

/**
 * КОМАНДА ИДЁТ ВНУТРЬ БАЗЫ — занимает место базы и агента в очереди (С1, аудит 14.09).
 *
 * Только `ib.admin`: вход в базу через ibcmd/COM. Кластерные команды (`cluster.admin`) идут через
 * rac, в базы не заходят — даже когда адресованы базе (снятие сеанса, блокировка входа, удаление
 * регистрации). Считать их «внутрь базы» значило ставить их в очередь за загрузкой той же базы:
 * загрузка ждёт выхода пользователей, а снятие их сеансов — загрузку.
 */
export const runsInsideBase = (spec: Pick<AdminCommandSpec, "capability">): boolean => spec.capability === "ib.admin";

/**
 * МОЖНО ЛИ КОМАНДЕ К ЭТОЙ БАЗЕ — по состоянию базы в реестре (С44, С45). `null` — можно.
 *
 * Скрытая база (`disabled`) скрыта ИЗ РАБОТЫ: внутрь неё команды не идут, а кластерные — идут, потому что именно
 * они её лечат (удалить регистрацию, закрыть вход). Раньше поиск по ключу скрытые не находил вовсе, и любая команда
 * отвечала «базы нет в реестре — обновите список», хотя обновление ничего не меняло.
 *
 * База, которой нет в кластере (`MISSING`), — не адрес ни для одной команды: ни внутрь, ни кластерной. Удалять
 * регистрацию, которой нет, агент отказывался бы через секунды «не найдена в кластере»; честнее сказать сразу и
 * назвать то, что поможет.
 */
export function baseRefusal(
	spec: Pick<AdminCommandSpec, "capability">,
	base: { key: string; disabled: boolean; clusterStatus: string },
): { status: number; code: string; message: string } | null {
	if (base.clusterStatus === "MISSING") {
		return {
			status: 409, code: "BASE_NOT_IN_CLUSTER",
			message: `Базы «${base.key}» нет в кластере — регистрация уже удалена. Уберите её из списка в карточке базы; `
				+ "если её зарегистрировали снова — обновите список из кластера",
		};
	}
	if (base.disabled && runsInsideBase(spec)) {
		return {
			status: 409, code: "BASE_HIDDEN",
			message: `База «${base.key}» скрыта из работы — верните её в работу в карточке базы (раздел «Доступность»)`,
		};
	}
	return null;
}

/**
 * Меняет ли ответ отметку «в базу не войти» (С5): только команды внутрь базы и не сухой прогон —
 * `dryRun` в базу по-настоящему не входит, и его успех не доказывает, что войти можно.
 */
export const marksReachability = (
	spec: Pick<AdminCommandSpec, "capability" | "requiresBase">, payload: Record<string, unknown>,
): boolean => spec.requiresBase && runsInsideBase(spec) && payload.dryRun !== true;

/**
 * Payload расписания — по схеме его команды и без секретов (С12). Расписание хранится в базе и
 * видно в панели: пароль или содержимое файла в нём оседали бы навсегда.
 */
export function validateSchedulePayload(type: string, payload: Record<string, unknown>, baseKey: string): string | null {
	for (const secret of ["password", "contentBase64", "auth"]) {
		if (secret in payload) return `payload: «${secret}» в расписании не хранится`;
	}
	const spec = findAdminCommand(type);
	if (!spec) return `type: команда ${type} не поддерживается`;
	const built = buildAdminPayload(spec, { ...payload, baseKey });
	return built.ok ? null : `payload: ${built.message}`;
}

/**
 * КЛЮЧ, ПО КОТОРОМУ ПОВТОР ПРИСОЕДИНЯЕТСЯ К УЖЕ ИДУЩЕЙ КОМАНДЕ (очередь склеивает команды с
 * одинаковым `requestId` среди незавершённых).
 *
 * ЧТЕНИЯ — всегда: два «Обновить» подряд не должны давать два входа в базу.
 * ДОЛГИЕ ИЗМЕНЯЮЩИЕ КОМАНДЫ ПО БАЗЕ (выгрузка, загрузка, обновление, проверка — срок LONG_COMMAND_TTL_SECS;
 * выгрузка тоже намеренно: вторая выгрузка той же базы поверх идущей бессмысленна, С28)
 * — тоже (С8, аудит 14.09): панель ждала их 15 минут и объявляла упавшими, а повтор ставил вторую
 * загрузку поверх идущей. Сухой прогон (`dryRun`) базу не меняет и не склеивается. Прочие
 * изменения — нет: у них «повторить» — законное намерение.
 */
export function commandRequestId(
	spec: Pick<AdminCommandSpec, "type" | "operation" | "ttlSeconds" | "readKey">,
	payload: Record<string, unknown>, baseKey: string | null,
): string | undefined {
	if (spec.operation === "READ") return `${spec.type}:${spec.readKey ? spec.readKey(payload) : (baseKey ?? "-")}`;
	if (spec.ttlSeconds === LONG_COMMAND_TTL_SECS && baseKey && payload.dryRun !== true) return `${spec.type}:${baseKey}`;
	return undefined;
}

/**
 * СПОСОБНОСТЬ, КОТОРУЮ ТРЕБУЕТ САМО СОДЕРЖИМОЕ КОМАНДЫ, а не её тип.
 *
 * `IB_UPDATE_USER` правит и реквизиты, и роли, и по типу ему достаточно `ib.admin`. Но роли
 * применяет только сборка со способностью `ib.roles` (13.09): прежние отвечали на
 * `addRoles`/`removeRoles`/`roles` успехом и ничего не меняли, а сборка без `ib.echo` вдобавок
 * не давала сервису это заметить — панель показывала «Выполнено». Решение администратора
 * (C5, 13.09): такие сборки правку ролей НЕ получают вовсе — отказ сразу, со словами «обновите
 * агента», вместо команды, которая молча ничего не сделает. Остальные команды (сеансы,
 * публикация, обслуживание) старая сборка выполняет, как и раньше.
 *
 * `null` — содержимое сверх `spec.capability` ничего не требует.
 */
export function requiredCapability(
	spec: Pick<AdminCommandSpec, "type">, payload: Record<string, unknown>,
): { capability: string; message: string } | null {
	if (spec.type === "IB_UPDATE_USER"
		&& (payload.addRoles !== undefined || payload.removeRoles !== undefined || payload.roles !== undefined)) {
		return {
			capability: "ib.roles",
			message: "Агент на сервере 1С не применяет правку ролей (нет способности ib.roles) — обновите агента",
		};
	}
	return null;
}

/** Чего агенту не хватает для ЭТОЙ команды с ЭТИМ содержимым; `null` — хватает всего. */
export function payloadRefusal(
	agent: Pick<AgentView, "capabilities">, spec: Pick<AdminCommandSpec, "type">, payload: Record<string, unknown>,
): string | null {
	const need = requiredCapability(spec, payload);
	return need && !agent.capabilities.includes(need.capability) ? need.message : null;
}

/**
 * Можно ли прервать команду (S4): она уже выполняется, это чтение, и агент умеет отмену.
 * Одно правило на маршрут прерывания и на признак `abortable` в заданиях — панель не должна
 * предлагать то, от чего сервис откажет.
 */
/**
 * Способность агента снимать конфигуратор отменённой проверки без «Исправлять» (А21). Без неё отмена
 * бросала бы задачу, а `1cv8` продолжал бы осмотр вне учёта агента — место базы освободилось бы поверх
 * работающего процесса (А14). Поэтому прерывание проверки — только агенту, который это объявил.
 */
export const CANCEL_CHECK_CAPABILITY = "agent.cancel.check";

/**
 * Какую начатую команду вообще позволено обрывать (С23): чтение — и проверку базы БЕЗ «Исправлять»:
 * осмотр `-TestOnly` базу не меняет. Выгрузку, загрузку, обновление и исправление не обрывают — база
 * осталась бы в промежуточном состоянии.
 */
export function abortAllowed(type: string, payload?: Record<string, unknown> | null): boolean {
	if (findAdminCommand(type)?.operation === "READ") return true;
	return type === "IB_CHECK" && payload?.repair !== true;
}

export function isAbortable(
	state: string, type: string,
	agent: boolean | { canCancel: boolean; canCancelCheck?: boolean },
	payload?: Record<string, unknown> | null,
): boolean {
	const a = typeof agent === "boolean" ? { canCancel: agent, canCancelCheck: false } : agent;
	if (state !== "dispatched" || !a.canCancel || !abortAllowed(type, payload)) return false;
	return type !== "IB_CHECK" || a.canCancelCheck === true;
}

export type AdminPayloadResult =
	| { ok: true; payload: Record<string, unknown>; baseKey: string | null }
	| { ok: false; message: string };

/**
 * КАК ПОЛЕ КОМАНДЫ НАЗЫВАЕТСЯ ПО-ЧЕЛОВЕЧЕСКИ.
 *
 * Имена полей придуманы для агента, а отказ по схеме читает человек в панели: «addRoles»
 * не говорит ему ничего, «добавляемые роли» — говорит всё. Поля, которых здесь нет,
 * называются как есть: выдуманное название хуже технического.
 */
const FIELD_TITLE: Record<string, string> = {
	baseKey: "база",
	name: "имя пользователя",
	newName: "новое имя пользователя",
	fullName: "полное имя",
	password: "пароль",
	roles: "список ролей",
	addRoles: "добавляемые роли",
	removeRoles: "снимаемые роли",
	disabled: "признак «отключён»",
	showInList: "признак «показывать в списке выбора»",
	osUser: "пользователь ОС",
	alias: "псевдоним",
};

/**
 * ОТКАЗ ПО СХЕМЕ — СЛОВАМИ, А НЕ КОДОМ БИБЛИОТЕКИ.
 *
 * Zod объясняется по-английски и терминами структуры: «Too big: expected array to have
 * <=100 items». В панели это выглядело как сбой неизвестной природы, хотя речь о простом:
 * список длиннее допустимого. Переводим то, что действительно встречается, — длину,
 * пустоту и тип; остальное отдаём как есть, потому что выдумывать формулировку для
 * неизвестного случая опаснее, чем показать оригинал.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
	const path = issue.path.join(".");
	const field = FIELD_TITLE[path] ?? path ?? "";
	const head = field ? `${field}: ` : "";

	if (issue.code === "too_big") {
		const max = issue.maximum;
		return issue.origin === "array"
			? `${head}слишком длинный список — не больше ${max}`
			: `${head}слишком длинное значение — не больше ${max} символов`;
	}
	if (issue.code === "too_small") {
		return Number(issue.minimum) <= 1 ? `${head}не заполнено` : `${head}слишком короткое значение`;
	}
	if (issue.code === "invalid_type") return `${head}неверное значение`;
	if (issue.code === "unrecognized_keys") return `команда не знает полей: ${issue.keys.join(", ")}`;
	return `${head}${issue.message}`;
}

/** Проверяет payload по схеме команды и достаёт из него ключ базы для маршрутизации. */
export function buildAdminPayload(spec: AdminCommandSpec, input: unknown): AdminPayloadResult {
	const parsed = spec.schema.safeParse(input ?? {});
	if (!parsed.success) {
		return { ok: false, message: describeIssue(parsed.error.issues[0]) };
	}
	const payload = parsed.data as Record<string, unknown>;
	const key = typeof payload.baseKey === "string" ? payload.baseKey : null;
	if (spec.requiresBase && !key) return { ok: false, message: "baseKey: не указана база" };
	return { ok: true, payload, baseKey: key };
}
