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
export type AgentCapability = "cluster.admin" | "ib.admin" | "agent.procs";

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
};

const baseKey = z.string().min(1).max(200);
// Имя пользователя ИБ и имя расширения — то, чем 1С их адресует.
const ibName = z.string().min(1).max(200);

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
		schema: z.object({ sessionId: z.string().min(1).max(64), baseKey: baseKey.optional() }).strict(),
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
			fullName: z.string().max(200).optional(),
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
			fullName: z.string().max(200).optional(),
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
			webServer: z.enum(["iis", "apache24"]).optional(),
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
			// Ни одна проверка не выбрана — агент сам берёт переиндексацию и логическую
			// целостность: пустой набор ключей конфигуратор понимает как «ничего не
			// проверять», и команда молча не делала бы ничего.
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
			webServer: z.enum(["iis", "apache24"]).optional(),
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
