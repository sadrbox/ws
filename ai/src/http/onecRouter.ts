// Администрирование 1С для панели aleppo.kz (E15/A3, A5-P0).
//
//   GET  /v1/onec/bases                      реестр баз (из БД, без обращения к кластеру)
//   POST /v1/onec/bases/refresh              перечитать список баз у админ-агента (rac); { publications, checkDb } — и публикации,
//                                            и выборочную проверку баз данных (новые и давно не проверявшиеся)
//   GET  /v1/onec/bases/:key/info            сведения о базе
//   DELETE /v1/onec/bases/:key               убрать из реестра базу, которой нет в кластере (С45)
//   GET  /v1/onec/sessions?baseKey=…         сеансы кластера или одной базы
//   GET  /v1/onec/connections?baseKey=…      соединения
//   POST /v1/onec/sessions/:id/terminate     снять сеанс                (CRITICAL)
//   POST /v1/onec/bases/:key/lock            блокировка начала сеансов  (CRITICAL)
//
// Список баз отдаётся ИЗ БАЗЫ СЕРВИСА, а не запросом в кластер на каждый показ: сто баз
// опрашивать при каждом открытии панели незачем — состояние приходит с heartbeat. Кнопка
// «обновить» существует ровно для случая, когда ждать heartbeat не хочется.
//
// Права: пока администратор организации или суперадмин. Именованное право OneCAdmin
// заводится в ERP вместе с панелью (A5) — тогда проверка переедет на него.

import { commandCaveat } from "../onec/caveats.ts";
import { isBusyFailure } from "../commands/queue.ts";
import { humanizeAgentError, normalizeLockedBy, parseLockedBy } from "../onec/errorHints.ts";
import { isDestructive } from "../onec/access.ts";
import { SECTION_OF_TYPE, agentsAllow, deniedMessage, onecRequirement, sectionAllows } from "../onec/permissions.ts";
import { BATCHABLE, BATCH_QUEUE_WAIT_SECS, isBatchError, startBatch } from "../onec/batchRunner.ts";
import { agentBuild, buildOutdated, missingFeatures } from "../agents/features.ts";
import { mergeDurationStats } from "../agents/commandStats.ts";
import { collectBusinessSlices, extensionBaseRows } from "../onec/extensionBases.ts";
import { describeAgentBases, parseLimit, type AgentBasesStore } from "../agents/agentBases.ts";
import type { RegistrationRow, RegistrationState, RegistrationStore } from "../bases/registrations.ts";
import type { BaseOrganizationsStore } from "../bases/organizations.ts";
import type { BaseChatExchangeStore } from "../bases/chatExchange.ts";
import type { BaseTokenStore } from "../bases/tokens.ts";
import type { ActivationState, ActivationStore } from "../agents/activation.ts";
import type { EnrollmentState, EnrollmentStore } from "../agents/enrollments.ts";
import { isDue, type MaintenanceSchedule, type ScheduleStore } from "../onec/schedules.ts";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireErpUser } from "../auth/index.ts";
import { rateLimit } from "./rateLimit.ts";
import type { AgentService } from "../agents/service.ts";
import { publicationReport, type BaseService, type BaseState, type PublicationItem } from "../bases/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import { CommandQueue as CommandQueueClass } from "../commands/queue.ts";
import type { BatchService } from "../onec/batches.ts";
import type { IbExtension, IbUser, OnecRegistry } from "../onec/registry.ts";
import type { CredentialsStore } from "../onec/credentials.ts";
import {
	DEFAULT_COMMAND_TTL_SECS, LONG_COMMAND_TTL_SECS, type AdminCommandSpec, agentCanRun, agentKnowsType, buildAdminPayload, commandRequestId, findAdminCommand, payloadRefusal,
	runsInsideBase, validateSchedulePayload, abortAllowed, isAbortable, CANCEL_CHECK_CAPABILITY, baseRefusal,
	type CommandRole,
} from "../commands/admin.ts";

type Deps = {
	erp: Db;
	cfg: Config;
	log: Logger;
	agents: AgentService;
	bases: BaseService;
	queue: CommandQueue;
	audit: Audit;
	batches: BatchService;
	registry: OnecRegistry;
	credentials: CredentialsStore;
	schedules: ScheduleStore;
	/** Срез баз бизнес-агентов (СВ3): карточка агента в панели. */
	agentBases: Pick<AgentBasesStore, "list" | "listMany">;
	/** Заявки на подключение баз и токены баз (СВ4). */
	registrations: RegistrationStore;
	baseTokens: Pick<BaseTokenStore, "list" | "revoke" | "rotate">;
	/**
	 * Что база сказала о себе сама по каналу чата: версия расширения и последний обмен (С2 аудита 23.09).
	 * Без него сводка отвечает как раньше — о базе без агента не знает ничего.
	 */
	chatExchange?: Pick<BaseChatExchangeStore, "list"> | null;
	/** Запросы активации БИНов (СВ4, часть 2). */
	activation: ActivationStore;
	/** Организации базы (задачи и заметки чата 1С): их БИНы база вправе называть. */
	baseOrgs?: Pick<BaseOrganizationsStore, "remember"> | null;
	/** Заявки на подключение агентов по коду (СВ5). */
	enrollments: EnrollmentStore;
};

/** Итог админ-команды: HTTP-статус и тело в общем конверте {success, data|error}. */
/**
 * Выборочная проверка баз данных внутри «Обновить» (18.09): что считать «давно не проверяли» и сколько баз брать
 * за раз. Сутки — потому что база из СУБД исчезает не сама по себе, а в чьих-то работах; двадцать баз при 0,3 с на
 * базу укладываются в несколько секунд, остальные дождутся следующего обновления или полной проверки по кнопке.
 */
const DB_CHECK_STALE_HOURS = 24;
const DB_CHECK_MAX_BASES = 20;

type Outcome = { status: number; body: Record<string, unknown>; data?: unknown };

const fail = (status: number, code: string, message: string): Outcome =>
	({ status, body: { success: false, error: { code, message } } });

/** Способность агента: умеет входить в базу учётной записью из payload.auth. */
const CAP_BASE_AUTH = "ib.auth";

export function onecRouter(deps: Deps) {
	const { erp, cfg, log, agents, bases, queue, audit, batches, registry, credentials, schedules, agentBases, registrations, baseTokens, activation, enrollments } = deps;
	const baseOrgs = deps.baseOrgs ?? null;
	const chatExchange = deps.chatExchange ?? null;
	/*
	 * СТРОГИЙ ПУТЬ (аудит 21.09). Гейты прав (onec/access.ts, onec/permissions.ts) сравнивают `req.path`
	 * регулярками с якорем конца, а нестрогий роутер express считает `/bases/acme/lock/` тем же маршрутом, что
	 * `/bases/acme/lock`. Одна лишняя косая черта — и запрос доходил до обработчика мимо ОБЕИХ проверок:
	 * «только просмотр» закрывал вход в базу и перезапускал агента. Со `strict` такой путь просто не совпадает
	 * ни с одним маршрутом (404), а гейты дополнительно смотрят на нормализованный путь — одной защиты мало.
	 */
	const r = Router({ strict: true });
	/** Путь для проверок прав: без хвостовых косых черт и в нижнем регистре не нуждается. */
	const gatePath = (req: Request): string => req.path.replace(/\/+$/, "") || "/";

	/*
	 * ОТКАЗ ПРОМИСА — ЭТО ОТВЕТ 500, А НЕ ПОВИСШИЙ ЗАПРОС (аудит 21.09). Обработчики здесь асинхронные, а express 4
	 * их отказы не ловит: сбой БД оставлял запрос без ответа (панель ждала до своего предела), а Node считал это
	 * необработанным отказом промиса. Оборачиваем ВСЕ маршруты роутера разом — по одному их забывают.
	 */
	for (const method of ["get", "post", "put", "patch", "delete"] as const) {
		const original = r[method].bind(r);
		(r as unknown as Record<string, (path: string, ...h: RequestHandler[]) => void>)[method] = (path: string, ...handlers: RequestHandler[]) => {
			original(path, ...handlers.map((h): RequestHandler => (req, res, next) => {
				Promise.resolve(h(req, res, next)).catch((e: unknown) => {
					log.error({ err: e instanceof Error ? e.message : String(e), path: req.path, method: req.method }, "маршрут панели 1С: сбой");
					if (!res.headersSent) send(res, fail(500, "INTERNAL", "Внутренняя ошибка сервиса — повторите позже"));
				});
			}));
		};
	}

	/*
	 * НЕСКОЛЬКО СЕРВЕРОВ 1С (C9–C11). Имя базы уникально только в пределах сервера, поэтому база адресуется парой
	 * «сервер + ключ»: сервер — `?serverId=`, поле `serverId` тела или заголовок `X-Onec-Server`. Пока сервер один,
	 * адрес не нужен и всё работает как раньше; одноимённые базы на разных серверах без сервера — 409 BASE_AMBIGUOUS.
	 */
	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const serverOf = (req: Request): string | null => {
		const q = (req.query as Record<string, unknown> | undefined)?.serverId;
		const b = (req.body as { serverId?: unknown } | undefined)?.serverId;
		const h = req.headers["x-onec-server"];
		const v = [q, b, h].find((x) => typeof x === "string" && UUID_RE.test(x));
		return typeof v === "string" ? v : null;
	};
	/** Серверы, видимые пользователю (C11); null — все. Считается раз на запрос. */
	const allowedCache = new WeakMap<Request, Promise<Set<string> | null>>();
	const allowedServers = (req: Request): Promise<Set<string> | null> => {
		const u = req.erpUser!;
		if (cfg.ONEC_SERVER_SCOPE !== "organizations" || u.isSuperAdmin) return Promise.resolve(null);
		let p = allowedCache.get(req);
		if (!p) {
			p = bases.listServers().then((list) => new Set(list
				.filter((x) => !!x.organizationUuid && u.allowedOrgUuids.includes(x.organizationUuid))
				.map((x) => x.id)));
			allowedCache.set(req, p);
		}
		return p;
	};
	/**
	 * СЕРВЕР БАЗЫ ДЛЯ ЗАПРОСА (аудит 21.09). Выбранный в панели; не выбран — единственный ВИДИМЫЙ сервер с этой
	 * базой. Без этого поиск по одному ключу мог взять базу невидимого сервера (`findByKeyGlobal` берёт первую по
	 * имени сервера), и команда уходила бы не туда, куда показывает панель.
	 */
	const baseServerOf = async (req: Request, key: string): Promise<string | null> => {
		const chosen = serverOf(req);
		if (chosen) return chosen;
		const { visible } = await visibleServersOf(req, key);
		return visible.length === 1 ? visible[0].id : null;
	};

	/** Серверы базы, видимые пользователю: больше одного без адреса — неоднозначно. */
	const visibleServersOf = async (req: Request, key: string) => {
		const all = await bases.serversWithKey(key);
		const allowed = await allowedServers(req);
		return { all, visible: allowed ? all.filter((x) => allowed.has(x.id)) : all };
	};
	/**
	 * ВИДЕН ЛИ АГЕНТ ЭТОМУ ПОЛЬЗОВАТЕЛЮ (C11, аудит 21.09). Список агентов фильтруется, а по идентификатору агента
	 * адресуются команды: прерывание, снятие процесса, настройки. Без этой проверки знание id открывало чужой сервер.
	 */
	const agentVisible = async (req: Request, agentId: string | null | undefined): Promise<boolean> => {
		const allowed = await allowedServers(req);
		if (!allowed || !agentId) return true;
		const a = await agents.findById(agentId);
		if (!a) return true;
		return a.role === "admin" ? !!a.serverId && allowed.has(a.serverId) : req.erpUser!.allowedOrgUuids.includes(a.organizationUuid);
	};

	/** Задание и команда адресуются по id: чужую организацию не показываем и не трогаем. */
	const batchVisible = async (req: Request, batchId: string): Promise<boolean> => {
		if (cfg.ONEC_SERVER_SCOPE !== "organizations" || req.erpUser!.isSuperAdmin) return true;
		const owner = await batches.ownerOf(batchId);
		return !owner || req.erpUser!.allowedOrgUuids.includes(owner.organizationUuid);
	};

	/**
	 * Общие для установки списки (заявки, токены баз, организации ERP) в многоклиентском режиме открыты только
	 * администратору BuhProf: в них БИНы, контакты и имена компьютеров всех клиентов сразу.
	 */
	const sharedListsAllowed = (req: Request): boolean =>
		cfg.ONEC_SERVER_SCOPE !== "organizations" || !!req.erpUser!.isSuperAdmin;

	/** Серверы, по которым считать сводки: выбранный кластер, иначе все видимые; null — все (один сервер). */
	const scopeServers = async (req: Request): Promise<string[] | null> => {
		const chosen = serverOf(req);
		if (chosen) return [chosen];
		const allowed = await allowedServers(req);
		return allowed ? [...allowed] : null;
	};

	const ambiguous = (key: string, servers: { id: string; name: string }[]): Outcome => ({
		status: 409,
		body: { success: false, error: {
			code: "BASE_AMBIGUOUS", message: `База «${key}» есть на нескольких серверах 1С (${servers.map((x) => x.name).join(", ")}) — выберите сервер`,
			details: { servers: servers.map((x) => ({ serverId: x.id, name: x.name })) },
		} },
	});

	/**
	 * Контекст для разбора отказа на входе в базу.
	 *
	 * Отвечает на вопрос человека, который задал базе учётную запись и всё равно получил
	 * «проверьте служебного администратора»: её не применили или она не подошла. Первое —
	 * когда агент не объявляет способность `ib.auth`, то есть его сборка ещё не читает
	 * payload.auth.
	 */
	const authContext = async (
		baseKey: string | null | undefined,
		agent: { capabilities?: string[] } | null,
	): Promise<{ baseAuthUser?: string | null; agentSupportsBaseAuth?: boolean }> => {
		if (!baseKey) return {};
		const users = await credentials.usersByBaseKeys([baseKey]);
		const user = users.get(baseKey);
		if (!user) return {};
		return { baseAuthUser: user, agentSupportsBaseAuth: !!agent?.capabilities?.includes(CAP_BASE_AUTH) };
	};
	r.use(requireErpUser(erp, cfg.JWT_SECRET));

	// Предел частоты — на КЛАСТЕР: он один на всю установку, и защищать нужно именно его.
	// Раньше ключом была организация, но администрирование от организации не зависит —
	// иначе один и тот же rac дёргали бы N раз по числу организаций. Локальное чтение
	// реестра баз (GET /bases) не считается: оно отвечает из своей БД и до rac не доходит.
	const clusterLimit = rateLimit({
		max: cfg.RATE_LIMIT_ONEC_CLUSTER_PER_MIN,
		windowMs: 60_000,
		key: () => "onec-cluster",
		// Из-под лимита выведено то, что до кластера НЕ доходит и отвечает из своей БД:
		// реестр баз, опрос готовности команды (он идёт раз в 2 с и один в одиночку съел бы
		// половину минутной квоты), сводки по кэшу, задания и список агентов.
		applies: (req) => {
			// Учётная запись базы — своя таблица сервиса, до кластера не доходит ни одним
			// методом: ни чтение, ни запись, ни удаление. Лимит защищает rac, а не БД.
			if (req.path.endsWith("/credentials")) return false;
			if (req.method !== "GET") return true;
			return !(
				req.path === "/bases" ||
				req.path === "/agents" ||
				req.path === "/servers" ||
				req.path === "/extensions" ||
				req.path === "/users" ||
				// Роли из кэша (без ?live=1) в 1С не ходят — лимит кластера к ним не относится.
				(req.path === "/roles" && req.query.live !== "1") ||
				req.path.startsWith("/roles/") ||
				req.path.endsWith("/users/cached") ||
				req.path.endsWith("/extensions/cached") ||
				req.path.startsWith("/commands/") ||
				req.path.startsWith("/batches") ||
				req.path.startsWith("/users/")
			);
		},
		message: "Слишком часто обращаемся к кластеру 1С — подождите немного",
	});
	r.use(clusterLimit);

	// Доступ даёт ПРАВО, а не организация: сервер 1С один на установку и никакой
	// организации ERP не принадлежит. Активная организация здесь ни при чём — раньше
	// требовалась она, и администрирование «работало, только если угадал организацию».
	r.use((req, res, next) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin && !u.canOnecAdmin) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Нужно право «Администрирование 1С»" } });
			return;
		}
		next();
	});

	/**
	 * ГЕЙТ РАЗРУШАЮЩИХ ДЕЙСТВИЙ (F5): уровень доступа `full`, а не просто наличие права.
	 *
	 * `readonly` видит состояние — списки, сеансы, задания, журнал, — а менять 1С может
	 * только `full`. Что именно считается изменением, перечислено в onec/access.ts: список
	 * описывает политику доступа, и его читают и проверяют отдельно от роутера.
	 *
	 * Отдельный код ошибки `FORBIDDEN_READONLY`: панель по нему отличает «права нет вовсе»
	 * от «права хватает только на просмотр» — это разные сообщения человеку.
	 */
	/*
	 * ВЛОЖЕННЫЕ РАЗРЕШЕНИЯ (решение 15.09): агенты — по уровню, пользователи баз и расширения — по действию и числу
	 * баз. Где они участвуют, общий «полный доступ» не нужен и не достаточен: действует вложенное разрешение.
	 */
	// Выбранный сервер должен быть виден пользователю (C11) — иначе адрес открывал бы чужой сервер.
	r.use(async (req, res, next) => {
		try {
			const sid = serverOf(req);
			const allowed = sid ? await allowedServers(req) : null;
			if (sid && allowed && !allowed.has(sid)) {
				send(res, fail(403, "SERVER_FORBIDDEN", "Этот сервер 1С вам недоступен"));
				return;
			}
			next();
		} catch (e) { next(e); }
	});
	/*
	 * АГЕНТ ПО ИДЕНТИФИКАТОРУ — ТОЛЬКО ВИДИМЫЙ (п. 7). Список агентов уже отфильтрован (C11), а переименовать,
	 * отключить или удалить можно было любого, зная id. Невидимый — как несуществующий.
	 */
	r.param("id", async (req, res, next, id) => {
		try {
			if (!gatePath(req).startsWith("/agents/")) { next(); return; }
			const allowed = await allowedServers(req);
			if (!allowed) { next(); return; }
			const a = await agents.findById(String(id));
			const visible = !a || (a.role === "admin" ? !!a.serverId && allowed.has(a.serverId) : req.erpUser!.allowedOrgUuids.includes(a.organizationUuid));
			if (!visible) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
			next();
		} catch (e) { next(e); }
	});
	// База в пути: не видна — как нет; есть на нескольких видимых серверах, а сервер не выбран — 409 (C10, C11).
	r.param("key", async (req, res, next, key) => {
		try {
			const { all, visible } = await visibleServersOf(req, String(key));
			if (all.length && !visible.length) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${String(key)}» нет в реестре`)); return; }
			if (!serverOf(req) && visible.length > 1) { send(res, ambiguous(String(key), visible)); return; }
			next();
		} catch (e) { next(e); }
	});

	r.use(async (req, res, next) => {
		try {
			const u = req.erpUser!;
			const need = onecRequirement(req.method, gatePath(req), req.body);
			if (!need || need.kind === "deferred") { next(); return; }
			let check = need;
			// Установка расширения туда, где оно уже есть, — обновление: это «редактирование», а не «создание».
			if (need.kind === "section" && need.type === "IB_INSTALL_EXTENSION") {
				const name = String(((req.body ?? {}) as { payload?: { name?: unknown } }).payload?.name ?? "").trim().toLowerCase();
				if (name && need.baseKeys.length) {
					const all = await bases.listAll();
					const has = (key: string) => all.find((b) => b.key.toLowerCase() === key.toLowerCase())
						?.extensionNames.some((n) => n.toLowerCase() === name) === true;
					if (need.baseKeys.every(has)) check = { ...need, action: "edit" };
				}
			}
			const allowed = check.kind === "agents"
				? agentsAllow(u.onec, check.level)
				: sectionAllows(u.onec, check.section, check.action, check.bases);
			if (!allowed) {
				res.status(403).json({ success: false, error: { code: "FORBIDDEN_ONEC_PERMISSION", message: deniedMessage(check, u.onec) } });
				return;
			}
			next();
		} catch (e) { next(e); }
	});

	r.use((req, res, next) => {
		// Вложенное разрешение уже проверено выше — общий гейт «полный доступ» к таким запросам не применяется.
		if (onecRequirement(req.method, req.path, req.body)) { next(); return; }
		if (isDestructive(req.method, gatePath(req), req.body) && !req.erpUser!.canOnecWrite) {
			res.status(403).json({
				success: false,
				error: {
					code: "FORBIDDEN_READONLY",
					message: "Доступ только на просмотр: для этого действия нужно право «Администрирование 1С» с полным доступом",
				},
			});
			return;
		}
		next();
	});

	/**
	 * Общий путь админ-команды: проверка payload → выбор админ-агента (по базе, если она
	 * указана) → гейт по capabilities → очередь → ожидание результата.
	 *
	 * Результат отдаётся синхронно: панель показывает сеансы здесь и сейчас, а не «команда
	 * поставлена». Если агент не ответил вовремя — это TIMEOUT, но команда ОСТАЁТСЯ в очереди
	 * и, скорее всего, выполнится; для CRITICAL текст говорит об этом прямо, иначе оператор
	 * повторит снятие сеанса, который уже снят.
	 */
	/**
	 * `target` — адресовать команду КОНКРЕТНОМУ агенту, а не выбирать по базе. Нужен отмене
	 * начатой команды (S4): отменять должен тот, кто её забрал, — при нескольких серверах
	 * выбранный по базе агент получил бы отмену чужой работы.
	 */
	/**
	 * КОМАНДА БИЗНЕС-АГЕНТУ ИЗ ПАНЕЛИ (п. 1). Админ-команды (commands/admin.ts) — только агенту кластера; у бизнес-
	 * агента свой набор, и из панели ему нужна лишь сводка о себе (HEALTH). Ответ — в той же форме, что у run():
	 * 200 с данными, 202 «ещё идёт» (панель дождётся по /commands/:id), 422 — отказ агента.
	 */
	async function runBusiness(req: Request, agent: { id: string; organizationUuid: string; online: boolean; disabled: boolean; capabilities: string[] }, type: string, payload: Record<string, unknown>, baseKey?: string | null): Promise<Outcome> {
		if (agent.disabled) return fail(409, "AGENT_DISABLED", "Агент отключён в панели");
		if (!agent.online) return fail(409, "AGENT_OFFLINE", "Агент не на связи — служба на компьютере не запущена или нет сети");
		/*
		 * Команду, которой сборка агента не знает, не ставим вовсе (аудит 22.09): иначе она ждёт исполнителя,
		 * уходит к агенту и возвращается через минуту с `UNKNOWN_COMMAND`. Ответ «обновите агента» тот же,
		 * но сразу и понятный.
		 */
		if (!agentKnowsType(agent, type)) {
			return fail(409, "CAPABILITY_MISSING", `Агент BuhProf этой базы не умеет команду ${type} — обновите агента на компьютере с 1С`);
		}
		const u = req.erpUser!;
		// База — и в колонке очереди: у многобазового агента без неё команда уйдёт не туда, а команды одной базы
		// должны идти по очереди (С1). У команд о самой службе (HEALTH) базы нет — там поле просто не ставится.
		const cmd = await queue.enqueue({ agentId: agent.id, organizationUuid: agent.organizationUuid, type, payload, userUuid: u.uuid, ttlSeconds: 120, ...(baseKey ? { baseKey } : {}) });
		await audit.write({ event: "onec.business", organizationUuid: agent.organizationUuid, userUuid: u.uuid, agentId: agent.id, commandId: cmd.id, details: { type } });
		const done = await queue.waitResult(cmd.id, cfg.ONEC_COMMAND_TIMEOUT_SECS * 1000);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return { status: 202, body: { success: true, data: { pending: true, commandId: cmd.id, state: done?.state === "dispatched" ? "dispatched" : "queued", dispatchedAt: null } } };
		}
		if (done.state !== "done") {
			const e = humanizeAgentError(done.error, {}) ?? { code: "COMMAND_FAILED", message: "Команда не выполнена" };
			return { status: 422, body: { success: false, error: e } };
		}
		return { status: 200, body: { success: true, data: done.result }, data: done.result };
	}

	async function run(req: Request, type: string, input: unknown, target?: { agentId: string }): Promise<Outcome> {
		const u = req.erpUser!;
		// Организация нужна только для журнала: команда адресуется серверу, а не орг.
		const org = u.organizationUuid;
		const spec: AdminCommandSpec | null = findAdminCommand(type);
		if (!spec) return fail(400, "UNKNOWN_COMMAND", `Команда ${type} не поддерживается`);

		const built = buildAdminPayload(spec, input);
		if (!built.ok) return fail(400, "VALIDATION_ERROR", built.message);

		// База, которой нет в реестре, — это НЕ «нет агента». Маршрутизация идёт через
		// реестр (база → сервер → агент), и при неизвестном ключе выбор исполнителя
		// проваливается; раньше пользователь получал «админ-агент недоступен», хотя агент
		// на связи, а не найдена именно база.
		const serverId = serverOf(req);
		const allowed = await allowedServers(req);
		if (built.baseKey && !target) {
			const { visible } = await visibleServersOf(req, built.baseKey);
			if (!serverId && visible.length > 1) return ambiguous(built.baseKey, visible);
		}
		if (built.baseKey) {
			const base = await bases.findByKeyGlobal(built.baseKey, serverId ?? await baseServerOf(req, built.baseKey));
			if (!base) {
				return fail(404, "UNKNOWN_BASE",
					`Базы «${built.baseKey}» нет в реестре. Обновите список из кластера — возможно, она появилась или была удалена`);
			}
			// Скрытая база и база, которой нет в кластере, — не «нет в реестре»: у каждой свой отказ и свой выход (С44).
			const refused = baseRefusal(spec, base);
			if (refused) return fail(refused.status, refused.code, refused.message);
		}

		if (target && !(await agentVisible(req, target.agentId))) return fail(404, "NOT_FOUND", "Агент не найден");
		const chosen = target ? await agents.findById(target.agentId) : await agents.pickAdminAgent(built.baseKey, { serverId, allowedServers: allowed });
		const agent = chosen && !chosen.disabled ? chosen : null;
		if (!agent) return await explainNoAgent(built.baseKey, spec.role);
		if (!agentCanRun(agent, spec)) {
			// Разделяем два разных случая: агента не настроили на этот класс операций
			// (нет способности) — или он просто старее сервиса и такой команды не знает.
			const known = agent.capabilities.includes(spec.capability) || (!!spec.capabilityAlt && agent.capabilities.includes(spec.capabilityAlt));
			return fail(409, "CAPABILITY_MISSING", known
				? `Агент не умеет команду «${spec.title}» (${spec.type}) — обновите агента на сервере 1С`
				: `Агент не умеет «${spec.title}»: нет способности ${spec.capability}`);
		}
		// Тип команде по силам, а содержимое — нет (C5: правка ролей без ib.roles).
		const refusal = payloadRefusal(agent, spec, built.payload);
		if (refusal) return fail(409, "CAPABILITY_MISSING", refusal);

		const cmd = await queue.enqueue({
			agentId: agent.id,
			// Команда принадлежит организации АГЕНТА (у неё сервер), а не активной
			// организации пользователя: журнал команд должен показывать, где выполнено.
			organizationUuid: agent.organizationUuid,
			baseKey: built.baseKey,
			// Кластерная команда с базой не занимает место базы (С1). Сухой прогон — тоже (С22): в базу
			// он не входит, а за долгой операцией план ждал бы единственное место до 15 минут.
			inBase: runsInsideBase(spec) && built.payload.dryRun !== true,
			type: spec.type,
			payload: built.payload,
			userUuid: u.uuid,
			// Срок берётся из спецификации: выгрузка базы идёт часами, и общие 15 минут
			// объявляли её просроченной посреди работы (см. LONG_COMMAND_TTL_SECS).
			// Сухой прогон ничего не меняет и ждётся на экране (С5): короткий срок и вперёд очереди.
			ttlSeconds: built.payload.dryRun === true ? DEFAULT_COMMAND_TTL_SECS : (spec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS),
			...(built.payload.dryRun === true ? { priority: -1 } : {}),
			// Одиночную команду человек ждёт на экране — ждать очереди ей не дольше обычного срока (С2).
			queueWaitSeconds: DEFAULT_COMMAND_TTL_SECS,
			/**
			 * ЧТЕНИЯ НЕ ДУБЛИРУЮТСЯ. Одна и та же база показана на нескольких экранах, и
			 * два «Обновить» подряд создавали ДВЕ команды: два входа в базу по десятку
			 * секунд там, где ответ один и тот же. Детерминированный requestId заставляет
			 * второй запрос присоединиться к уже идущей команде и получить её результат —
			 * очередь умеет это с самого начала (частично-уникальный индекс среди
			 * незавершённых), просто им никто не пользовался.
			 *
			 * Изменяющие склеиваются только долгие по базе (выгрузка, загрузка, обновление, проверка —
			 * С8, С28): повтор после «слишком долго» ставил вторую загрузку поверх идущей.
			 */
			...((): { requestId?: string } => {
				const requestId = commandRequestId(spec, built.payload, built.baseKey);
				return requestId ? { requestId } : {};
			})(),
		});
		await audit.write({
			event: "onec.admin",
			organizationUuid: org ?? undefined,
			userUuid: u.uuid,
			agentId: agent.id,
			commandId: cmd.id,
			details: { type: spec.type, operation: spec.operation, baseKey: built.baseKey, title: spec.title },
		});
		log.info({ type: spec.type, baseKey: built.baseKey, agentId: agent.id, userUuid: u.uuid }, "админ-команда 1С");

		const done: CommandRow | null = await queue.waitResult(cmd.id, cfg.ONEC_COMMAND_TIMEOUT_SECS * 1000);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			// НЕ ошибка: команда исполняется. Отдаём её идентификатор, клиент дождётся
			// короткими опросами. Держать HTTP-запрос дольше нельзя — вход в базу занимает
			// у агента до 15 минут, а туннель обрывает такой запрос СВОИМ ответом, без
			// заголовков CORS, и браузер показывает это как ошибку CORS.
			return { status: 202, body: { success: true, data: {
				pending: true, commandId: cmd.id,
				// Ждёт очереди или уже выполняется — панели разные слова (С20).
				state: done?.state === "dispatched" ? "dispatched" : "queued",
				dispatchedAt: done?.dispatched_at ? new Date(done.dispatched_at).toISOString() : null,
			} } };
		}
		if (done.state !== "done") {
			const e = humanizeAgentError(done.error, await authContext(built.baseKey, agent))
				?? { code: "COMMAND_FAILED", message: "Команда не выполнена" };
			// 422, а НЕ 502. Агент отработал и вернул отказ — это ошибка предметной области,
			// а не сбой шлюза. Cloudflare трактует 5xx от источника буквально: подменяет наш
			// ответ своей HTML-страницей, у которой нет заголовков CORS, и браузер показывает
			// это как «Access-Control-Allow-Origin missing». Именно так терялись все
			// сообщения об ошибках 1С — текст до панели не доезжал.
			/*
			 * ЧТО ПАНЕЛИ ДЕЛАТЬ С ЭТИМ ОТКАЗОМ (С38, П25). `retryable` — отказ временный, повтор осмыслен: у
			 * группового задания сервис повторяет сам, а одиночную команду человек ждёт на экране, и решать ему.
			 * `lockedBy` — кто держит базу, полями: по ним панель предложит снять сеанс, а не пересказывать абзац.
			 */
			// Поля агента — главные; свой разбор текста — только у агентов старше 12:13 (С42).
			const agentHeld = typeof e.details === "object" && e.details ? (e.details as { lockedBy?: unknown }).lockedBy : undefined;
			const lockedBy = normalizeLockedBy(agentHeld) ?? parseLockedBy(e.message);
			return { status: 422, body: { success: false, error: {
				...e,
				retryable: isBusyFailure(e.code, e.message),
				...(lockedBy ? { details: { ...(typeof e.details === "object" && e.details ? e.details : {}), lockedBy } } : {}),
			} } };
		}
		/*
		 * ОГОВОРКИ УСПЕХА (С41): «кластер не отдал состояние», «расширение встало под другим именем» — одним текстом
		 * в `caveat`, рядом с ответом агента. Раньше до итога операции доезжал только голый успех.
		 */
		const caveat = commandCaveat(spec.type, done.result);
		const data = caveat && done.result && typeof done.result === "object" && !Array.isArray(done.result)
			? { ...(done.result as Record<string, unknown>), caveat }
			: done.result ?? null;
		return { status: 200, body: { success: true, data }, data };
	}

	/**
	 * Почему исполнителя нет. Один текст «не настроен или не на связи» на все случаи
	 * заводит в тупик: агент может быть жив и здоров, но принадлежать ДРУГОЙ организации
	 * — при AGENT_ORG_BINDING=strict он тогда невидим, и человеку не за что зацепиться.
	 * Разбираем ситуацию и называем её.
	 */
	/** `any` — команда о самой службе: её исполняет любая роль, и «нет агента» считается по всем. */
	async function explainNoAgent(baseKey: string | null, role: CommandRole): Promise<Outcome> {
		const all = (await agents.listAll()).filter((a) => !a.disabled && (role === "any" || a.role === role));
		const kind = role === "admin" ? "Админ-агент 1С" : "Агент 1С";

		if (!all.length) return fail(409, "ADMIN_AGENT_UNAVAILABLE", `${kind} не зарегистрирован`);

		if (!all.some((a) => a.online)) {
			const last = all.map((a) => (a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0)).reduce((m, t) => Math.max(m, t), 0);
			const ago = last ? `${Math.round((Date.now() - last) / 60000)} мин назад` : "ни разу";
			return fail(409, "ADMIN_AGENT_OFFLINE", `${kind} не на связи (последний раз — ${ago}). Проверьте службу на сервере 1С`);
		}
		// Агент на связи, но команда адресована базе с другого сервера.
		return fail(409, "ADMIN_AGENT_UNAVAILABLE", baseKey
			? `Для базы «${baseKey}» нет агента на связи: она числится за другим сервером 1С`
			: `${kind} не на связи`);
	}

	const send = (res: Response, o: Outcome) => { res.status(o.status).json(o.body); };

	r.get("/bases", async (req, res) => {
		// Выбранный кластер — то, что показано: иначе в списке баз одного сервера видны базы другого (аудит 21.09).
		const allowed = await allowedServers(req);
		const chosen = serverOf(req);
		const items = (await bases.listAll())
			.filter((b) => (!allowed || allowed.has(b.serverId)) && (!chosen || b.serverId === chosen));
		/*
		 * ВЕРСИИ РАСШИРЕНИЯ ЗДЕСЬ НЕТ, И ЭТО НАМЕРЕННО (23.09, по разбору с владельцем).
		 *
		 * Колонка «Расширение» в списке баз показывала «не видели» почти всегда: реестр кластера наполняет
		 * АДМИН-агент, а версию расширения знает БИЗНЕС-агент. Подмешивание её из среза (А1 того же дня)
		 * лечило симптом лишь там, где на клиенте работают оба агента и оба видят одну базу; в остальных
		 * установках колонка так и оставалась пустой — а пустая колонка читается как «расширения нет».
		 *
		 * Версия живёт там, где собирается из всех источников и всегда осмысленна: `GET /extension-bases`
		 * («Расширение БухПроф-AI» → «Базы с расширением»). Поле `extVersion` в ответе остаётся — оно из
		 * реестра и держится резервом под админ-агента, если тот когда-нибудь научится читать версию.
		 */
		res.json({ success: true, data: { items } });
	});

	/**
	 * Обновить состояние публикаций: спрашиваем веб-сервер один раз за все базы.
	 *
	 * Раньше признак публикации мог прийти только со срезом баз (агент его не шлёт) или
	 * после нашей же команды IB_PUBLISH — то есть у ста баз он оставался «не проверялся»
	 * навсегда. Здесь он берётся у источника.
	 */
	/**
	 * Проверка публикаций: агент читает веб-сервер, сервис применяет срез, панель узнаёт,
	 * ЧТО ИМЕННО нашлось.
	 *
	 * Раньше в ответе было одно число — длина списка, — и панель радостно сообщала
	 * «Проверено публикаций: 110», хотя опубликованной не нашлось НИ ОДНОЙ, срез был
	 * отвергнут как недостоверный и состояние ста десяти баз осталось прежним. Кнопка
	 * говорила «сделано», не сделав ничего: это и есть «проверка работает некорректно».
	 *
	 * Теперь отдаём разбор среза: сколько баз в нём, сколько из них опубликованы, объявлен
	 * ли список полным, принят ли он — и где агент искал. По этим полям панель пишет
	 * человеку правду, включая неприятную.
	 */
	/**
	 * Ответ на проверку публикаций — реестром и разбором среза, одним способом для ответа сразу и
	 * для ответа после ожидания (`GET /commands/:id`, С7): сырые строки агента другой формы, и
	 * панель клала их в список баз.
	 */
	/** Срез публикаций из ответа агента: строки, признак полноты и где агент искал. */
	const parsePublications = (raw: unknown) => {
		const data = raw as {
			items?: PublicationItem[]; complete?: boolean; source?: string; lookedIn?: string[];
		} | null;
		return {
			items: Array.isArray(data?.items) ? data.items : [],
			complete: data?.complete === true,
			evidence: {
				source: typeof data?.source === "string" ? data.source : null,
				lookedIn: Array.isArray(data?.lookedIn) ? data.lookedIn.length : 0,
			},
		};
	};
	const publicationsReport = (raw: unknown) => {
		const { items, complete, evidence } = parsePublications(raw);
		return { ...publicationReport(items, complete, evidence), ...evidence };
	};
	const publicationsAnswer = async (raw: unknown) => ({ items: await bases.listAll(), report: publicationsReport(raw) });

	r.post("/publications/refresh", async (req, res) => {
		const outcome = await run(req, "CLUSTER_LIST_PUBLICATIONS", {});
		if (outcome.status !== 200) { send(res, outcome); return; }

		// Применять здесь нечего: срез уже применён на общем пути приёма результатов
		// (agentRouter), куда он попадает раньше, чем run() возвращает управление. Второе
		// применение было бы не ошибкой, а лишней парой мест, которые обязаны совпадать.
		// А вот РАЗБОР среза повторяем — теми же правилами, той же функцией.
		res.json({ success: true, data: await publicationsAnswer(outcome.data) });
	});

	// Ручное обновление реестра: спрашиваем список у кластера и сразу применяем к базе сервиса,
	// чтобы панель обновилась в этом же запросе, не дожидаясь ближайшего heartbeat.
	/*
	 * `{ publications: true }` — заодно проверить публикации (17.09): кнопка «Обновить» списка баз.
	 *
	 * ОБЕ КОМАНДЫ СРАЗУ, а не друг за другом. Это команды кластера: сервис выдаёт их агенту без очереди друг за
	 * другом и места базы они не занимают (queue.claim). Сколько бы агент ни выполнял их сам, лишнего ожидания
	 * на стороне сервиса нет: ни второго запроса панели, ни второго ожидания результата.
	 *
	 * ПОРЯДОК ПРИМЕНЕНИЯ всё же нужен: срез публикаций сопоставляется с базами реестра, и ответ, пришедший раньше
	 * списка, не находил только что зарегистрированных баз. Поэтому после синхронизации списка срез публикаций
	 * применяется ещё раз — запись идемпотентна (один словарь, один UPDATE), зато новые базы получают свой признак.
	 *
	 * Публикации не решают судьбу обновления: список баз обновлён — ответ 200, а по публикациям отдельно разбор,
	 * «ещё идёт» или отказ.
	 */
	r.post("/bases/refresh", async (req, res) => {
		const body = (req.body ?? {}) as { publications?: unknown; checkDb?: unknown };
		const withPublications = body.publications === true;
		const withDbCheck = body.checkDb === true;
		/*
		 * ВСЕ СЕРВЕРЫ ИЛИ ВЫБРАННЫЙ (C9). Без сервера «Обновить» спрашивает каждый видимый сервер через его админ-агента
		 * — параллельно, итог сводится в один ответ; с сервером — только его. Сервер один — ровно как раньше.
		 */
		const only = serverOf(req);
		const allowed = await allowedServers(req);
		const admins = (await agents.listAll()).filter((a) => !a.disabled && a.online && a.role === "admin" && !!a.serverId
			&& (!only || a.serverId === only) && (!allowed || allowed.has(a.serverId!)));
		// Одного агента на сервер: два админ-агента одного сервера — не повод спрашивать кластер дважды.
		const perServer = [...new Map(admins.map((a) => [a.serverId!, a])).values()];
		if (!perServer.length) {
			// Агента нет — объяснение даст общий путь команды (нет агента, не на связи, нет способности).
			send(res, await run(req, "CLUSTER_LIST_INFOBASES", {}));
			return;
		}
		const results = await Promise.all(perServer.map((a) => refreshServer(req, a.id, a.serverId!, withPublications, withDbCheck)));
		const ok = results.filter((x) => x.outcome.status === 200);
		if (!ok.length) {
			/*
			 * Ни один сервер не ответил. Отдаём первый отказ как есть (панель различает 202/422/409), но при
			 * нескольких серверах добавляем разбор: иначе из трёх разных причин человек видел одну (аудит 21.09).
			 */
			const first = results[0].outcome;
			const body = results.length > 1 && first.body && typeof first.body === "object"
				? { ...first.body, servers: results.map((x) => ({ serverId: x.serverId, status: x.outcome.status, error: (x.outcome.body as { error?: unknown }).error ?? null })) }
				: first.body;
			send(res, { ...first, body });
			return;
		}
		// Один сервер — прежняя форма ответа; несколько — сводка плюс разбор по серверам.
		const one = results.length === 1 ? results[0] : null;
		const dbChecks = ok.map((x) => x.dbCheck).filter((d): d is { checked: number; missing: number } => !!d && "checked" in d);
		const dbCheck = one ? one.dbCheck
			: withDbCheck ? { checked: dbChecks.reduce((n, d) => n + d.checked, 0), missing: dbChecks.reduce((n, d) => n + d.missing, 0) } : undefined;
		const publications = one ? one.publications : ok.find((x) => x.publications)?.publications;
		send(res, { status: 200, body: { success: true, data: {
			items: (await bases.listAll()).filter((b) => !allowed || allowed.has(b.serverId)),
			...(publications ? { publications } : {}),
			...(dbCheck ? { dbCheck } : {}),
			...(one ? {} : { servers: results.map((x) => ({ serverId: x.serverId, status: x.outcome.status, publications: x.publications, dbCheck: x.dbCheck,
				...(x.outcome.status === 200 ? {} : { error: (x.outcome.body as { error?: unknown }).error ?? null }) })) }),
		} } });
	});

	/** «Обновить» одного сервера: список баз, публикации и выборочная проверка баз данных — через его админ-агента. */
	async function refreshServer(req: Request, agentId: string, serverId: string, withPublications: boolean, withDbCheck: boolean) {
		const target = { agentId };
		const [outcome, pub] = await Promise.all([
			run(req, "CLUSTER_LIST_INFOBASES", {}, target),
			withPublications ? run(req, "CLUSTER_LIST_PUBLICATIONS", {}, target) : Promise.resolve(null),
		]);
		if (outcome.status !== 200) return { serverId, outcome, publications: undefined, dbCheck: undefined };
		const items = (outcome.data as { items?: BaseState[] } | null)?.items;
		// Пустой список НЕ применяем: полный срез с complete+authoritative пометил бы все
		// базы как пропавшие. Агент, вернувший ноль баз, скорее сломан, чем прав.
		if (Array.isArray(items) && items.length) {
			await bases.sync(serverId, items, { complete: true, authoritative: true });
			if (pub?.status === 200) {
				const p = parsePublications(pub.data);
				if (p.items.length) await bases.applyPublications(serverId, p.items, p.complete, p.evidence);
			}
		}
		/*
		 * ПРОВЕРКА БАЗ ДАННЫХ — ВЫБОРОЧНО (18.09). Полная проверка всех баз идёт десятки секунд и стучится в СУБД по
		 * каждой базе (живой замер 17.09: 111 баз — 34 с), поэтому в «Обновить» она входит только для тех, кого ещё
		 * не проверяли (новые в кластере) или проверяли давно. Обычно это ноль баз и нисколько времени; полная
		 * проверка осталась отдельной командой «Проверить базы данных».
		 */
		let dbCheck: { checked: number; missing: number } | { pending: true; commandId: string | null } | { error: unknown } | undefined;
		if (withDbCheck) {
			const stale = await bases.staleDbCheck(serverId, DB_CHECK_STALE_HOURS, DB_CHECK_MAX_BASES);
			if (stale.length) {
				const checked = await run(req, "CLUSTER_CHECK_BASES", { baseKeys: stale }, target);
				dbCheck = checked.status === 200
					? {
						checked: (checked.data as { checked?: number } | null)?.checked ?? stale.length,
						missing: ((checked.data as { items?: { dbMissing?: boolean }[] } | null)?.items ?? [])
							.filter((i) => i.dbMissing === true).length,
					}
					: checked.status === 202
						? { pending: true, commandId: (checked.body.data as { commandId?: string } | undefined)?.commandId ?? null }
						: { error: (checked.body as { error?: unknown }).error };
			} else {
				dbCheck = { checked: 0, missing: 0 };
			}
		}
		const publications = !pub ? undefined
			: pub.status === 200 ? { report: publicationsReport(pub.data) }
				: pub.status === 202 ? { pending: true, commandId: (pub.body.data as { commandId?: string } | undefined)?.commandId ?? null }
					: { error: (pub.body as { error?: unknown }).error ?? { code: "COMMAND_FAILED", message: "Проверка публикаций не выполнена" } };
		return { serverId, outcome, publications, dbCheck };
	}

	/**
	 * «Проверить базы данных» (S3): есть ли у зарегистрированных баз их база данных в СУБД.
	 *
	 * Тело `{ baseKeys? }` — отмеченные базы; пусто — все базы кластера. Отметки в реестре
	 * ставит приём результата (agentRouter), а не этот обработчик: на сотне баз ответ идёт
	 * дольше ONEC_COMMAND_TIMEOUT_SECS, и панель получит 202 и дождётся команды сама.
	 * Чтение: пути нет в списке разрушающих, и проверка доступна уровню `readonly`.
	 */
	r.post("/bases/check-db", async (req, res) => {
		const raw = (req.body as { baseKeys?: unknown } | undefined)?.baseKeys;
		send(res, await run(req, "CLUSTER_CHECK_BASES", Array.isArray(raw) && raw.length ? { baseKeys: raw } : {}));
	});

	r.get("/bases/:key/info", async (req, res) => {
		send(res, await run(req, "CLUSTER_INFOBASE_INFO", { baseKey: req.params.key }));
	});

	/**
	 * СВЕДЕНИЯ О БАЗЕ (С35): конфигурация, расширения и блокировка входа — одним входом в базу, по кнопке
	 * «Обновить сведения». Чтение: пути нет в списке разрушающих, доступно и просмотру.
	 *
	 * Реестр пишет приём результата (agentRouter) — до того, как команда объявлена выполненной (С36), поэтому
	 * к ответу отсюда прочитанное уже в реестре и карточке достаточно перечитать базы.
	 */
	r.get("/bases/:key/ib-info", async (req, res) => {
		send(res, await run(req, "IB_INFO", { baseKey: req.params.key }));
	});

	r.get("/sessions", async (req, res) => {
		const filter = typeof req.query.baseKey === "string" && req.query.baseKey ? { baseKey: req.query.baseKey } : {};
		send(res, await run(req, "CLUSTER_LIST_SESSIONS", filter));
	});

	r.get("/connections", async (req, res) => {
		const filter = typeof req.query.baseKey === "string" && req.query.baseKey ? { baseKey: req.query.baseKey } : {};
		send(res, await run(req, "CLUSTER_LIST_CONNECTIONS", filter));
	});

	r.get("/locks", async (req, res) => {
		const filter = typeof req.query.baseKey === "string" && req.query.baseKey ? { baseKey: req.query.baseKey } : {};
		send(res, await run(req, "CLUSTER_LIST_LOCKS", filter));
	});

	r.get("/processes", async (req, res) => {
		send(res, await run(req, "CLUSTER_LIST_PROCESSES", {}));
	});

	r.get("/licenses", async (req, res) => {
		send(res, await run(req, "CLUSTER_LIST_LICENSES", {}));
	});

	r.post("/connections/:id/disconnect", async (req, res) => {
		const body = (req.body ?? {}) as { baseKey?: string };
		send(res, await run(req, "CLUSTER_DISCONNECT", {
			connectionId: req.params.id,
			...(body.baseKey ? { baseKey: body.baseKey } : {}),
		}));
	});

	r.post("/sessions/:id/terminate", async (req, res) => {
		const body = (req.body ?? {}) as { baseKey?: string };
		send(res, await run(req, "CLUSTER_TERMINATE_SESSION", {
			sessionId: req.params.id,
			...(body.baseKey ? { baseKey: body.baseKey } : {}),
		}));
	});

	// ── Содержимое базы: пользователи ИБ и расширения (A3-P1) ───────────────────
	// Спрашиваем 1С вживую и тут же кладём в кэш: сводные экраны («в каких базах есть
	// пользователь») читают кэш, иначе каждый показ стоил бы ста подключений.
	/**
	 * Пользователи базы ИЗ КЭША — без обращения к 1С.
	 *
	 * Нужен, чтобы смотреть базу «сверху вниз» (кто в ней заведён) так же дёшево, как
	 * пользователя «сверху вниз» (в каких он базах). Чтение живой базы стоит десятки секунд
	 * и занимает сеанс 1С — для просмотра списка это неприемлемая цена.
	 */
	r.get("/bases/:key/users/cached", async (req, res) => {
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		res.json({ success: true, data: { items: await registry.usersOfBase(base.id) } });
	});

	r.get("/bases/:key/users", async (req, res) => {
		const outcome = await run(req, "IB_LIST_USERS", { baseKey: req.params.key });
		await cacheList(req.params.key, await baseServerOf(req, req.params.key), outcome, (id, items) => registry.syncUsers(id, items as IbUser[]));
		send(res, outcome);
	});

	/**
	 * Расширения базы ИЗ КЭША — без обращения к 1С.
	 *
	 * У пользователей такой путь был с самого начала, у расширений — нет, и карточка базы
	 * открывалась с пустой таблицей, хотя прочитанное лежало в реестре (`base_extensions`,
	 * из него же считается счётчик «Расширений» в списке баз). Выглядело это как «панель
	 * не показывает расширения»: показать было что, спросить — некого.
	 *
	 * Живое чтение (ручка ниже) — это вход в базу на минуты; для показа известного такая
	 * цена не нужна. Поэтому карточка открывается кэшем и говорит, когда он прочитан, а
	 * «Обновить» идёт к самой 1С.
	 */
	r.get("/bases/:key/extensions/cached", async (req, res) => {
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		res.json({ success: true, data: { items: await registry.extensionsOfBase(base.id) } });
	});

	r.get("/bases/:key/extensions", async (req, res) => {
		const outcome = await run(req, "IB_LIST_EXTENSIONS", { baseKey: req.params.key });
		await cacheList(req.params.key, await baseServerOf(req, req.params.key), outcome, (id, items) => registry.syncExtensions(id, items as IbExtension[]));
		send(res, outcome);
	});

	/** Общая часть двух ручек выше: успешный список → в кэш базы. */
	async function cacheList(
		key: string,
		serverId: string | null,
		outcome: Outcome,
		sync: (baseId: string, items: unknown[]) => Promise<void>,
	): Promise<void> {
		if (outcome.status !== 200) return;
		const items = (outcome.data as { items?: unknown[] } | null)?.items;
		if (!Array.isArray(items)) return;
		const base = await bases.findByKeyGlobal(key, serverId);
		if (base) await sync(base.id, items);
	}

	/**
	 * Агенты, которых видит панель. Нужны не для красоты: без способности `ib.admin`
	 * ни одна операция внутри баз невозможна, и пользователь должен узнать это ДО того,
	 * как нажмёт кнопку и получит «пропущено 110 из 110».
	 */
	/**
	 * Серверы 1С и их публичные имена — экран «Настройки».
	 *
	 * Публичное имя нужно ровно для одного: собрать рабочую ссылку на опубликованную базу.
	 * Агент отдаёт адрес из привязки сайта IIS, и при привязке без имени узла это
	 * `http://localhost/<база>` — честно, но снаружи бесполезно. Подменять ответ агента в
	 * данных нельзя (иначе ошибку в самой привязке нечем заметить), поэтому имя живёт
	 * отдельно и применяется только к показу.
	 */
	r.get("/servers", async (req, res) => {
		const allowed = await allowedServers(req);
		res.json({ success: true, data: { items: (await bases.listServers()).filter((x) => !allowed || allowed.has(x.id)) } });
	});

	/**
	 * Поле, которого НЕТ в запросе, не меняется; присланное пустым — СТИРАЕТСЯ. Это разные
	 * намерения, и различать их обязательно: «оставить как было» и «убрать» — не одно и то
	 * же, а одинаково выглядят, если принимать всё подряд за новое значение.
	 */
	r.patch("/servers/:id", async (req, res) => {
		const b = (req.body ?? {}) as Record<string, unknown>;
		const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
		const port = b.rasPort === null ? null
			: (typeof b.rasPort === "number" && Number.isInteger(b.rasPort) && b.rasPort > 0 && b.rasPort < 65536
				? b.rasPort : undefined);

		// Чужой сервер не правим и не показываем (C11): иначе через :id правились адреса rac чужого кластера.
		const allowed = await allowedServers(req);
		if (allowed && !allowed.has(req.params.id)) { send(res, fail(404, "NOT_FOUND", "Сервер не найден")); return; }
		const ok = await bases.updateServer(req.params.id, {
			name: str("name"), publicHost: str("publicHost"), rasHost: str("rasHost"), rasPort: port,
		});
		if (!ok) { send(res, fail(404, "NOT_FOUND", "Сервер не найден")); return; }
		res.json({ success: true, data: { items: (await bases.listServers()).filter((x) => !allowed || allowed.has(x.id)) } });
	});

	/**
	 * СОСТОЯНИЕ ОЧЕРЕДИ И СРЕДНИЕ ДЛИТЕЛЬНОСТИ — чтобы панель могла сказать, чего ждать.
	 *
	 * ЗАЧЕМ. Человек видит счётчик «сделано 7 из 110» и не знает главного: это сорок минут
	 * или три. И команда в состоянии `queued` выглядит так же, как выполняющаяся, — не
	 * отличить «агент занят другой базой» от «агента нет на связи». Оба ответа есть в
	 * данных, их просто никто не спрашивал.
	 *
	 * Средняя длительность считается по ФАКТИЧЕСКИ выполненным командам за последнюю неделю
	 * и по времени от выдачи до ответа: «сколько идёт сама работа», а не «сколько провисело
	 * в очереди». Медленное чтение базы и мгновенная команда кластера не смешиваются —
	 * среднее считается по каждому типу отдельно.
	 */
	r.get("/queue-stats", async (_req, res) => {
		const stats = await queue.stats();
		const holders = await queue.runningCommands();
		// «Некому забрать» и «занят» — разные ответы, и различает их наличие живого
		// админ-агента, а не длина очереди.
		const live = (await agents.listAll()).filter((a) => a.role === "admin" && a.online && !a.disabled);
		res.json({ success: true, data: {
			...stats,
			agentsOnline: live.length,
			agentsBusy: live.filter((a) => a.busy).length,
			// Сколько команд внутрь базы агент получает одновременно: из него и считается
			// оценка времени массовой операции.
			ibParallel: cfg.AGENT_IB_PARALLEL,
			// Кто держит очередь (R5): прервать панель предлагает только чтения — как и маршрут abort.
			runningCommands: holders.map(({ payload, canCancel, canCancelCheck, ...c }) => ({
				...c, abortable: isAbortable("dispatched", c.type, { canCancel, canCancelCheck }, payload),
			})),
			// Время по типам — сводно по снимкам живых агентов (S5).
			agentDurations: mergeDurationStats(live.map((a) => a.commandStats?.durationsByType)),
		} });
	});

	/**
	 * СОСТОЯНИЕ СЕРВЕРА И ЖУРНАЛ АГЕНТА (R1, R2) — ЭТОМУ агенту, а не выбранному по базе: карточка
	 * агента спрашивает о нём самом. Чтения — полного доступа не требуют (GET).
	 */
	/** Самопроверка операций агента в базе (R4): временный пользователь создаётся и удаляется. */
	r.post("/bases/:key/selftest", async (req, res) => {
		send(res, await run(req, "IB_SELFTEST", { baseKey: req.params.key }));
	});

	/**
	 * САМОПРОВЕРКА БАЗЫ (СВ16). Одна кнопка вместо расспросов: расширение в базе отвечает, что у него не так —
	 * нет токена сервиса, нет организаций с БИН, старая версия, не хватает прав. Сегодня это выясняется по
	 * частям и разными людьми: связь проверяет панель, токен — форма в 1С, права — по отказу конкретной операции.
	 *
	 * Исполняет БИЗНЕС-агент: проверка идёт внутри базы через расширение, а не через rac. Отказ «нет агента»
	 * отличаем от «агент не на связи» — лечатся они по-разному.
	 */
	r.post("/bases/:key/self-check", async (req, res) => {
		const org = req.erpUser!.organizationUuid;
		if (!org) {
			send(res, fail(409, "ORGANIZATION_REQUIRED", "Выберите активную организацию: базу проверяет агент BuhProf этой организации"));
			return;
		}
		const agent = await agents.pickAgentFor(org, req.params.key, "business");
		if (!agent) {
			send(res, fail(409, "AGENT_OFFLINE", `Базу «${req.params.key}» некому проверить: агент BuhProf, обслуживающий её, не на связи или не настроен`));
			return;
		}
		send(res, await runBusiness(req, agent, "SELF_CHECK", {}, req.params.key));
	});

	r.get("/agents/:id/health", async (req, res) => {
		const agent = await agents.findById(req.params.id);
		// Бизнес-агент (п. 1): своей AGENT_HEALTH у него нет — сводку по базам и лимитам даёт его команда HEALTH.
		if (agent?.role === "business") { send(res, await runBusiness(req, agent, "HEALTH", {})); return; }
		send(res, await run(req, "AGENT_HEALTH", {}, { agentId: req.params.id }));
	});

	/**
	 * НАСТРОЙКИ САМОЙ СЛУЖБЫ (задача агенту §3): чтение — команда агенту, правка — белый список агента.
	 * Секретов в ответе нет: пароли и токены приходят признаком «задан».
	 */
	r.get("/agents/:id/config", async (req, res) => {
		send(res, await run(req, "AGENT_CONFIG_GET", {}, { agentId: req.params.id }));
	});

	r.put("/agents/:id/config", async (req, res) => {
		const patch = (req.body as { patch?: unknown } | undefined)?.patch;
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
			send(res, fail(400, "VALIDATION_ERROR", "patch: объект с изменяемыми полями настроек"));
			return;
		}
		const outcome = await run(req, "AGENT_CONFIG_SET", { patch }, { agentId: req.params.id });
		if (outcome.status === 200) {
			await audit.write({ event: "agent.config", agentId: req.params.id, userUuid: req.erpUser!.uuid,
				details: { fields: Object.keys(patch as Record<string, unknown>), changed: (outcome.data as { changed?: unknown } | null)?.changed ?? null } });
		}
		send(res, outcome);
	});

	/** Перезапуск службы (задача агенту §2). Начатые изменяющие команды агент дожидается сам — тогда AGENT_BUSY. */
	r.post("/agents/:id/restart", async (req, res) => {
		const reason = String((req.body as { reason?: unknown } | undefined)?.reason ?? "").trim().slice(0, 500);
		const outcome = await run(req, "AGENT_RESTART", reason ? { reason } : {}, { agentId: req.params.id });
		if (outcome.status === 200) {
			await audit.write({ event: "agent.restart", agentId: req.params.id, userUuid: req.erpUser!.uuid, details: { reason: reason || null } });
		}
		send(res, outcome);
	});

	/**
	 * Обновление службы (задача агенту §2). Сборка, адрес и хэш — из настроек сервиса (AGENT_UPDATE_URL,
	 * AGENT_UPDATE_SHA256) либо из запроса; ход обновления приходит в heartbeat и виден в карточке агента.
	 */
	r.post("/agents/:id/update", async (req, res) => {
		const b = (req.body ?? {}) as { build?: unknown; url?: unknown; sha256?: unknown };
		const build = String(b.build ?? cfg.AGENT_LATEST_BUILD ?? "").trim();
		// В номере сборки есть пробел и двоеточие («2026-09-20 10:55») — в адресе они должны быть закодированы.
		const url = String(b.url ?? cfg.AGENT_UPDATE_URL ?? "").trim().replace("{build}", encodeURIComponent(build));
		const sha256 = String(b.sha256 ?? cfg.AGENT_UPDATE_SHA256 ?? "").trim();
		if (!build || !url || !sha256) {
			send(res, fail(400, "VALIDATION_ERROR",
				"Укажите сборку, адрес файла (https) и его SHA-256 — или задайте AGENT_UPDATE_URL и AGENT_UPDATE_SHA256 в настройках сервиса"));
			return;
		}
		const outcome = await run(req, "AGENT_UPDATE", { build, url, sha256, restart: true }, { agentId: req.params.id });
		if (outcome.status === 200) {
			// Адрес и сборка — в журнал; хэш там не нужен, он проверяется агентом.
			await audit.write({ event: "agent.update", agentId: req.params.id, userUuid: req.erpUser!.uuid, details: { build, url } });
		}
		send(res, outcome);
	});

	/** Команды агента (п. 2): очередь, выполняемые, последние итоги. Тело payload в список не входит. */
	r.get("/agents/:id/commands", async (req, res) => {
		const limit = Number.parseInt(String((req.query as Record<string, unknown>).limit ?? "50"), 10) || 50;
		const rows = await queue.listForAgent(req.params.id, limit);
		res.json({ success: true, data: { items: rows.map((c) => {
			const v = CommandQueueClass.toView(c);
			return { id: v.id, type: v.type, baseKey: v.baseKey, state: v.state, requestId: v.requestId,
				error: v.error ? { code: (v.error as { code?: string }).code ?? null, message: (v.error as { message?: string }).message ?? null } : null,
				createdAt: v.createdAt, dispatchedAt: v.dispatchedAt, finishedAt: v.finishedAt };
		}) } });
	});

	/** Журнал действий над агентом (п. 3): имена пользователей — из ERP, не нашлось — идентификатор. */
	r.get("/agents/:id/audit", async (req, res) => {
		const rows = await audit.listForAgent(req.params.id);
		const uuids = [...new Set(rows.map((x) => x.userUuid).filter((x): x is string => !!x))];
		const names = new Map<string, string>();
		if (uuids.length) {
			try {
				const u = await erp.query<{ uuid: string; username: string | null; email: string | null }>(
					`SELECT uuid, username, email FROM users WHERE uuid = ANY($1::text[])`, [uuids]);
				for (const x of u.rows) names.set(x.uuid, x.username || x.email || x.uuid);
			} catch (e) {
				log.warn({ err: e instanceof Error ? e.message : String(e) }, "журнал агента: имена пользователей ERP не прочитаны");
			}
		}
		res.json({ success: true, data: { items: rows.map((x) => ({ ...x, userName: x.userUuid ? names.get(x.userUuid) ?? x.userUuid : null })) } });
	});

	/*
	 * ОТКАЗЫ ЧАТА 1С ПО ЗАДАЧАМ И ЗАМЕТКАМ (СВ8). Эти события не принадлежат ни агенту, ни базе:
	 * их порождает чат в 1С, обращаясь к ERP. Видны они были только в логе службы — а разбор
	 * «у клиента задача не создалась» начинается в панели.
	 *
	 * Организацию показываем именем: uuid в журнале не говорит ничего тому, кто его читает.
	 */
	r.get("/chat-failures", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const q = req.query as Record<string, unknown>;
		// Карточка базы спрашивает про себя, общий разбор — про всех: один маршрут, один отбор.
		const baseId = typeof q.baseId === "string" && /^[0-9a-f-]{36}$/i.test(q.baseId) ? q.baseId : null;
		const rows = await audit.listChatFailures({ baseId, limit: Number(q.limit) || 200 });
		const orgs = [...new Set(rows.map((x) => x.organizationUuid).filter((x): x is string => !!x))];
		const names = new Map<string, string>();
		if (orgs.length) {
			try {
				const o = await erp.query<{ uuid: string; name: string | null; legal_name: string | null }>(
					`SELECT uuid, name, "legalName" AS legal_name FROM organizations WHERE uuid = ANY($1::text[])`, [orgs]);
				for (const x of o.rows) names.set(x.uuid, x.name || x.legal_name || x.uuid);
			} catch (e) {
				log.warn({ err: e instanceof Error ? e.message : String(e) }, "отказы чата 1С: имена организаций не прочитаны");
			}
		}
		res.json({ success: true, data: { items: rows.map((x) => ({
			at: x.at, tool: x.tool, code: x.code, message: x.message,
			organizationName: x.organizationUuid ? names.get(x.organizationUuid) ?? x.organizationUuid : null,
			baseId: typeof x.details.baseId === "string" ? x.details.baseId : null,
			bin: typeof x.details.bin === "string" ? x.details.bin : null,
		})) } });
	});

	/**
	 * БАЗЫ С РАСШИРЕНИЕМ BuhProf AI — сводка ПО ИСТОЧНИКАМ РАСШИРЕНИЯ, а не по реестру кластера (23.09).
	 *
	 * Реестр баз ведёт админ-агент и показывает выбранный КЛАСТЕР; расширение живёт в базе и к кластеру не
	 * привязано — у клиента без админ-агента его базы в том списке не появятся вовсе. Поэтому здесь три своих
	 * источника: заявки на подключение, выданные токены и срез баз бизнес-агентов. Отбора по серверу нет
	 * намеренно: вопрос «где стоит расширение» задают про всю установку.
	 */
	r.get("/extension-bases", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		/*
		 * «ОБНОВИТЬ» ЗНАЧИТ «СПРОСИ ЗАНОВО» (А2 аудита 23.09). Срезы кэшируются на 15 секунд, и нажатие сразу
		 * после того, как клиент обновил расширение, возвращало прежнюю версию: человек либо ждал вслепую,
		 * либо решал, что обновление не дошло. Кнопка панели шлёт `fresh=1` и читает мимо кэша; обычное
		 * открытие раздела кэш использует — там он и нужен.
		 */
		const fresh = String((req.query as Record<string, unknown>).fresh ?? "") === "1";
		const slices = await collectBusinessSlices(agents, agentBases, { fresh });
		const rows = extensionBaseRows({
			registrations: (await registrations.list({ limit: 500 })).map((r) => ({
				baseKey: r.baseKey, baseName: r.baseName, state: r.state, organizationUuid: r.organizationUuid,
				decidedAt: r.decidedAt, extensionVersion: r.body?.base?.extensionVersion ?? null,
			})),
			tokens: (await baseTokens.list(null)).map((t) => ({
				baseKey: t.baseKey, organizationUuid: t.organizationUuid,
				createdAt: t.createdAt, revokedAt: t.revokedAt, replacedBy: t.replacedBy, acceptedUntil: t.acceptedUntil,
			})),
			slices,
			// Чем отвечает база, у которой агента нет вовсе: её собственные запросы (С2 аудита 23.09).
			chat: chatExchange ? await chatExchange.list() : [],
		});
		// Организацию показываем именем: uuid ничего не говорит тому, кто читает список.
		const orgs = [...new Set(rows.map((r) => r.organizationUuid).filter((x): x is string => !!x))];
		const orgNames = new Map<string, string>();
		if (orgs.length) {
			try {
				const o = await erp.query<{ uuid: string; name: string | null; legal_name: string | null }>(
					`SELECT uuid, name, "legalName" AS legal_name FROM organizations WHERE uuid = ANY($1::text[])`, [orgs]);
				for (const x of o.rows) orgNames.set(x.uuid, x.name || x.legal_name || x.uuid);
			} catch (e) {
				log.warn({ err: e instanceof Error ? e.message : String(e) }, "базы с расширением: имена организаций не прочитаны");
			}
		}
		res.json({ success: true, data: { items: rows.map((r) => ({
			...r, organizationName: r.organizationUuid ? orgNames.get(r.organizationUuid) ?? r.organizationUuid : null,
		})) } });
	});

	/*
	 * ЖУРНАЛ ВЫЗОВОВ ЧАТА (ПН8). Дополняет «отказы чата» выше: там только неудачи серверных инструментов, а
	 * здесь весь след канала — что вызывали, по какой базе и чем кончилось, включая вызовы в саму 1С.
	 * Карточка базы спрашивает про себя (baseId), общий разбор — про всех.
	 */
	r.get("/chat-calls", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const q = req.query as Record<string, unknown>;
		const baseId = typeof q.baseId === "string" && /^[0-9a-f-]{36}$/i.test(q.baseId) ? q.baseId : null;
		const rows = await audit.listChatCalls({ baseId, limit: Number(q.limit) || 200 });
		const orgs = [...new Set(rows.map((x) => x.organizationUuid).filter((x): x is string => !!x))];
		const names = new Map<string, string>();
		if (orgs.length) {
			try {
				const o = await erp.query<{ uuid: string; name: string | null; legal_name: string | null }>(
					`SELECT uuid, name, "legalName" AS legal_name FROM organizations WHERE uuid = ANY($1::text[])`, [orgs]);
				for (const x of o.rows) names.set(x.uuid, x.name || x.legal_name || x.uuid);
			} catch (e) {
				log.warn({ err: e instanceof Error ? e.message : String(e) }, "журнал вызовов чата: имена организаций не прочитаны");
			}
		}
		res.json({ success: true, data: { items: rows.map((x) => ({
			...x, organizationName: x.organizationUuid ? names.get(x.organizationUuid) ?? x.organizationUuid : null,
		})) } });
	});

	r.get("/agents/:id/log", async (req, res) => {
		const q = req.query as Record<string, unknown>;
		const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
		const lines = text(q.lines);
		const level = text(q.level);
		const contains = text(q.contains);
		// Параметры проверяет схема команды: «lines=abc» — отказ VALIDATION_ERROR, а не молчаливые 200 строк.
		send(res, await run(req, "AGENT_LOG_TAIL", {
			...(lines !== undefined ? { lines: Number(lines) } : {}),
			...(level !== undefined ? { level } : {}),
			...(contains !== undefined ? { contains } : {}),
		}, { agentId: req.params.id }));
	});

	/**
	 * БАЗЫ БИЗНЕС-АГЕНТА И ЛИМИТ ТАРИФА (ПН, 19.09): срез, который агент прислал сам, с пометками «сверх лимита» по
	 * правилу сервиса — тем же, по которому сервис отвергает команды.
	 */
	r.get("/agents/:id/bases", async (req, res) => {
		const agent = await agents.findById(req.params.id);
		if (!agent) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		const view = describeAgentBases(await agentBases.list(agent.id), agent.limits);
		res.json({ success: true, data: { ...view, role: agent.role, canEditLimits: !!req.erpUser!.isSuperAdmin } });
	});

	/**
	 * Лимит тарифа — только администратор BuhProf: это условие договора, а не настройка сервера 1С, и право
	 * «Администрирование 1С» у клиента не должно позволять поднять себе тариф. Пусто — без ограничения.
	 */
	r.put("/agents/:id/limits", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Лимит тарифа меняет только администратор BuhProf")); return; }
		const body = (req.body ?? {}) as { maxBases?: unknown; maxBins?: unknown };
		const agent = await agents.findById(req.params.id);
		if (!agent) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		if (agent.role !== "business") { send(res, fail(409, "NOT_BUSINESS_AGENT", "Лимит баз и БИНов — у бизнес-агента")); return; }
		// Не названное поле — прежнее значение: запрос про один лимит не должен молча снимать другой.
		const maxBases = "maxBases" in body ? parseLimit(body.maxBases) : agent.limits.maxBases;
		const maxBins = "maxBins" in body ? parseLimit(body.maxBins) : agent.limits.maxBins;
		if (maxBases === undefined || maxBins === undefined) {
			send(res, fail(400, "VALIDATION_ERROR", "Лимит — целое число от 0 или пусто (без ограничения)"));
			return;
		}
		await agents.setLimits(agent.id, { maxBases, maxBins });
		await audit.write({ event: "agent.limits", agentId: agent.id, userUuid: u.uuid, details: { before: agent.limits, after: { maxBases, maxBins } } });
		res.json({ success: true, data: describeAgentBases(await agentBases.list(agent.id), { maxBases, maxBins }) });
	});

	r.get("/agents", async (req, res) => {
		// Видимость (C11): админ-агенты — по серверу, бизнес-агенты — по организации ERP.
		const allowed = await allowedServers(req);
		const orgs = req.erpUser!.allowedOrgUuids;
		const all = (await agents.listAll()).filter((a) => !allowed
			|| (a.role === "admin" ? !!a.serverId && allowed.has(a.serverId) : orgs.includes(a.organizationUuid)));
		const slices = await agentBases.listMany(all.filter((a) => a.role === "business").map((a) => a.id));
		// Экземпляры (процессы) агента: два процесса под одним токеном разбирают одну
		// очередь, и если их настройки разошлись — команды отказывают ЧЕРЕЗ РАЗ. Ни в одном
		// логе это не написано, поэтому показываем счёт прямо в панели.
		const items = await Promise.all(all.map(async (a) => ({
			id: a.id, name: a.name, role: a.role, online: a.online,
			// Лимит тарифа бизнес-агента (СВ3); у админ-агента его нет.
			...(a.role === "business" ? { limits: a.limits } : {}),
			// Что сервис знает об агенте и раньше не показывал (п. 6), и ход обновления службы (§2).
			os: a.os, status: a.status, onecReachable: a.onec.reachable, registeredAt: a.registeredAt, update: a.update,
			organizationUuid: a.organizationUuid, commandsDone: a.commandsDone, commandsFailed: a.commandsFailed,
			...(a.role === "business" ? { basesCount: (slices.get(a.id) ?? []).length } : {}),
			capabilities: a.capabilities, lastSeenAt: a.lastSeenAt, disabled: a.disabled,
			// Сборка и её отставание (R3): «Устарел» — по эталону AGENT_LATEST_BUILD, «нет в этой
			// сборке» — по способностям, которые агент объявил.
			version: a.version, build: agentBuild(a.version),
			buildOutdated: buildOutdated(a.version, cfg.AGENT_LATEST_BUILD),
			missingFeatures: missingFeatures(a),
			// Версия платформы 1С на сервере агента. Панель показывает её в карточке базы,
			// когда сам агент не прислал версию по базе: платформа у всех баз одного
			// сервера одна, и «неизвестно» здесь — отсутствие ответа, а не разнобой.
			serverId: a.serverId, platform: a.onec.version,
			// «Выполняет команду» — не то же самое, что «на связи»: агент как раз молчит,
			// и молчание ожидаемо. Без этого остановленная посреди команды служба выглядела
			// в панели работающей.
			busy: a.busy,
			// Отказы по кодам и время команд с последнего запуска службы (S5): «агент тормозит»
			// и «часть команд падает» — числами, а не замером вручную.
			commandStats: a.commandStats,
			// Сутки истории — чтобы владельцем можно было назначить и молчащий экземпляр
			// (займёт аренду, как поднимется). Признак `live` у каждой строки отделяет
			// работающие процессы от прежних запусков: смешивать их нельзя, иначе панель
			// объявляет двойным запуском обычную историю перезапусков.
			instances: await agents.liveInstances(a.id, 24 * 60 * 60, cfg.AGENT_OFFLINE_AFTER_SECS),
			// Владелец токена: единственный экземпляр, которому разрешено работать.
			owner: await agents.owner(a.id),
		})));
		res.json({ success: true, data: { items, limits: {
			checkParallel: cfg.ONEC_CHECK_PARALLEL,
			// Эталон сборки и откуда её брать (задача агенту §2): панель заполняет ими окно обновления.
			latestBuild: cfg.AGENT_LATEST_BUILD ?? null,
			updateUrl: cfg.AGENT_UPDATE_URL ?? null,
			updateSha256: cfg.AGENT_UPDATE_SHA256 ?? null,
			// Сроки команд сервиса (С24, вариант Б): панель сравнивает с пределами агента и предупреждает, если
			// предел агента не меньше срока — команда будет объявлена просроченной посреди работы.
			commandTtlSecs: DEFAULT_COMMAND_TTL_SECS,
			longCommandTtlSecs: LONG_COMMAND_TTL_SECS,
			// Остаток общей квоты обращений к кластеру: она одна на всю установку, и, когда
			// кончается, отказ выглядит как вина того, кто нажал последним. Панель видит
			// остаток заранее — этот ответ она и так опрашивает раз в 15 секунд.
			clusterPerMin: cfg.RATE_LIMIT_ONEC_CLUSTER_PER_MIN,
			clusterRemaining: clusterLimit.remaining("onec-cluster"),
		} } });
	});

	/**
	 * Управление агентами из панели. Раньше агента заводили только консольной командой с
	 * `AGENT_ADMIN_KEY` — то есть человек, у которого есть право «Администрирование 1С»,
	 * всё равно шёл к тому, у кого есть доступ к серверу. Здесь те же операции под тем же
	 * правом, что и остальная панель.
	 *
	 * Токен показывается ОДИН раз: в БД лежит только его SHA-256, восстановить нельзя —
	 * забыли, значит ротация.
	 */
	/**
	 * Снять владение токеном вручную.
	 *
	 * Нужно там, где владелец не отдаёт его сам: машину выключили жёстко, службу
	 * перенесли, экземпляр «завис». Аренда истечёт и сама, но ждать полный интервал
	 * офлайна, глядя на неработающую панель, — не то, чего ждут от администратора.
	 */
	/**
	 * Переименовать агента. Имя — подпись для человека: агент присылает своё при
	 * регистрации, но «Сервер 1С, админ (кластер)» понятнее, чем то, как назвалась служба.
	 */
	r.patch("/agents/:id", async (req, res) => {
		const u = req.erpUser!;
		const name = String((req.body as { name?: unknown })?.name ?? "").trim();
		if (!name) { send(res, fail(400, "VALIDATION_ERROR", "name: укажите имя агента")); return; }
		const ok = await agents.rename(req.params.id, name);
		if (!ok) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		await audit.write({ event: "agent.rename", agentId: req.params.id, userUuid: u.uuid, details: { name } });
		res.json({ success: true, data: { ok: true } });
	});

	/**
	 * Удалить агента.
	 *
	 * Только отключённого: удалить работающего — значит оборвать команды на полпути и
	 * оставить службу на сервере 1С стучаться в никуда с валидным токеном. Сначала
	 * «Отключить», убедиться, что ничего не сломалось, потом удалять.
	 */
	r.delete("/agents/:id", async (req, res) => {
		const u = req.erpUser!;
		const agent = await agents.findById(req.params.id);
		if (!agent) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		if (!agent.disabled) {
			send(res, fail(409, "AGENT_ENABLED",
				"Сначала отключите агента: у работающей службы останется действующий токен, "
				+ "а незавершённые команды оборвутся."));
			return;
		}
		try {
			await agents.remove(req.params.id);
		} catch (e) {
			/*
			 * ССЫЛКА ИЗ ТАБЛИЦЫ, ПРО КОТОРУЮ ЗАБЫЛИ, — НЕ «ВНУТРЕННЯЯ ОШИБКА».
			 *
			 * Так оно и случилось: `conversations.agent_id` не отвязывали, база отвечала
			 * нарушением внешнего ключа, а панель показывала общий отказ. Человек видел
			 * «агент не удаляется» и не имел ни одной зацепки. Теперь называем таблицу,
			 * которая держит запись: следующий такой ключ найдётся за минуту, а не за час.
			 */
			const err = e as { code?: string; table?: string; constraint?: string };
			if (err?.code === "23503") {
				send(res, fail(409, "AGENT_REFERENCED",
					`Агента держат записи в таблице «${err.table ?? "?"}» (${err.constraint ?? "внешний ключ"})`));
				return;
			}
			throw e;
		}
		await audit.write({ event: "agent.delete", agentId: null, userUuid: u.uuid,
			details: { id: req.params.id, name: agent.name } });
		res.json({ success: true, data: { ok: true } });
	});

	/** Назначить владельцем конкретный экземпляр: аренду мог занять не тот компьютер. */
	r.post("/agents/:id/owner", async (req, res) => {
		const u = req.erpUser!;
		const instanceId = String((req.body as { instanceId?: unknown })?.instanceId ?? "").trim();
		if (!instanceId) { send(res, fail(400, "VALIDATION_ERROR", "instanceId: укажите экземпляр")); return; }
		const ok = await agents.setOwnership(req.params.id, instanceId);
		if (!ok) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		await audit.write({ event: "agent.instance.assign", agentId: req.params.id, userUuid: u.uuid,
			details: { instanceId } });
		res.json({ success: true, data: { ok: true } });
	});

	r.post("/agents/:id/release-instance", async (req, res) => {
		const u = req.erpUser!;
		const ok = await agents.releaseOwnership(req.params.id);
		if (!ok) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		await audit.write({ event: "agent.instance.release", agentId: req.params.id, userUuid: u.uuid });
		res.json({ success: true, data: { ok: true } });
	});

	r.post("/agents", async (req, res) => {
		const u = req.erpUser!;
		const name = String((req.body as { name?: unknown })?.name ?? "").trim();
		if (!name) { send(res, fail(400, "VALIDATION_ERROR", "name: укажите имя агента")); return; }
		/*
		 * АГЕНТ КЛАСТЕРА — БЕЗ ОРГАНИЗАЦИИ. Он обслуживает весь сервер 1С: базы всех клиентов, и выбирается по
		 * серверу, а не по организации ERP. Бизнес-агент, наоборот, ходит в базы своей организации — ему она нужна.
		 */
		const cluster = (req.body as { cluster?: unknown } | undefined)?.cluster === true;
		// Агент кластера заводится с ролью admin сразу: роль назначается здесь, а не со слов агента.
		if (!cluster && !u.organizationUuid) {
			send(res, fail(409, "ORGANIZATION_REQUIRED", "Выберите активную организацию — к ней будет привязан агент (агенту кластера организация не нужна)"));
			return;
		}

		const { agent, token } = await agents.create(cluster ? "" : u.organizationUuid ?? "", name, cluster ? "admin" : "business");
		log.info({ agentId: agent.id, userUuid: u.uuid }, "агент создан из панели");
		await audit.write({ event: "agent.create", agentId: agent.id, organizationUuid: agent.organizationUuid, userUuid: u.uuid });
		res.status(201).json({ success: true, data: { agent, token } });
	});

	r.post("/agents/:id/rotate-token", async (req, res) => {
		const token = await agents.rotateToken(req.params.id);
		if (!token) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		await audit.write({ event: "agent.rotate_token", agentId: req.params.id, userUuid: req.erpUser!.uuid });
		res.json({ success: true, data: { token } });
	});

	for (const action of ["disable", "enable"] as const) {
		r.post(`/agents/:id/${action}`, async (req, res) => {
			const ok = await agents.setDisabled(req.params.id, action === "disable");
			if (!ok) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
			await audit.write({ event: `agent.${action}`, agentId: req.params.id, userUuid: req.erpUser!.uuid });
			res.json({ success: true, data: { ok: true } });
		});
	}

	// ── Сводки по всем базам (кэш, без обращения к 1С) ──────────────────────────
	r.get("/users", async (req, res) => {
		res.json({ success: true, data: { items: await registry.userSummary(await scopeServers(req)) } });
	});

	/**
	 * Роли для выбора при создании и изменении пользователя.
	 *
	 * По умолчанию — те, что уже встречались в базах (кэш, без обращения к 1С): их десяток,
	 * и обычно назначают именно их. `?baseKey=` сужает до одной базы, `?live=1` спрашивает
	 * справочник конфигурации у самой базы командой IB_LIST_ROLES — там их сотни, но зато
	 * это полный список с точными идентификаторами.
	 */
	r.get("/roles", async (req, res) => {
		const baseKey = typeof req.query.baseKey === "string" ? req.query.baseKey : undefined;
		if (req.query.live === "1" && baseKey) {
			const outcome = await run(req, "IB_LIST_ROLES", { baseKey });
			send(res, outcome);
			return;
		}
		res.json({ success: true, data: { items: await registry.knownRoles(baseKey) } });
	});

	/**
	 * Сколько держателей роли в каждой базе — для защиты «последний администратор».
	 * Кэш, без обращения к 1С.
	 */
	r.get("/roles/:role/holders", async (req, res) => {
		res.json({ success: true, data: { items: await registry.roleHolders(req.params.role) } });
	});

	/** Что делали с пользователем из панели — по журналу команд. */
	r.get("/users/:name/history", async (req, res) => {
		res.json({ success: true, data: { items: await registry.userHistory(req.params.name) } });
	});

	/**
	 * Где есть этот пользователь — ответ на «покажи его во всех базах».
	 *
	 * Пустое имя ОТВЕРГАЕМ явно. Express по умолчанию не различает `/users` и `/users/`,
	 * поэтому запрос с пустым именем молча попадал в сводку и возвращал строки другой
	 * формы — без `baseKey`. Панель падала на них уже при отрисовке, и место падения
	 * ничего не говорило о причине.
	 */
	r.get("/users/:name", async (req, res) => {
		const name = req.params.name.trim();
		if (!name) { send(res, fail(400, "VALIDATION_ERROR", "name: укажите имя пользователя")); return; }
		res.json({ success: true, data: { items: await registry.findUser(name) } });
	});

	r.get("/extensions", async (req, res) => {
		res.json({ success: true, data: { items: await registry.extensionSummary(await scopeServers(req)) } });
	});

	// ── Пакетные операции по выбранным базам (A4) ───────────────────────────────
	// Отвечаем СРАЗУ идентификатором задания, а не ждём сто подключений к 1С: панель
	// показывает прогресс опросом. Ждать здесь означало бы держать HTTP-запрос минуты.
	//
	// Сама постановка — в onec/batchRunner.ts: тем же кодом задание ставит расписание
	// обслуживания (F2), и двух расходящихся реализаций одного действия быть не должно.
	r.post("/batch", async (req, res) => {
		const u = req.erpUser!;
		const body = (req.body ?? {}) as { type?: string; baseKeys?: unknown; payload?: Record<string, unknown> };
		const type = String(body.type ?? "").toUpperCase();
		const keys = Array.isArray(body.baseKeys) ? body.baseKeys.filter((k): k is string => typeof k === "string" && !!k) : [];

		const started = await startBatch({ agents, queue, batches, bases }, {
			type, baseKeys: keys, payload: body.payload ?? {},
			organizationUuid: u.organizationUuid ?? "", userUuid: u.uuid,
			serverId: serverOf(req), allowedServers: await allowedServers(req),
		});
		if (isBatchError(started)) {
			// Неизвестная команда и негодный вход — разные отказы, и панель их различает:
			// первый значит «так не бывает», второй — «поправьте поле».
			const code = BATCHABLE.has(type) ? "VALIDATION_ERROR" : "UNKNOWN_COMMAND";
			send(res, fail(400, code, started.error));
			return;
		}

		const spec = findAdminCommand(type)!;
		await audit.write({
			event: "onec.batch", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: {
				type, total: started.total, queued: started.queued,
				skipped: started.skipped.length, title: spec.title,
			},
		});
		log.info({
			type, total: started.total, queued: started.queued,
			skipped: started.skipped.length, userUuid: u.uuid,
		}, "пакетная команда 1С");

		res.status(202).json({ success: true, data: started });
	});

	// ── Обслуживание по расписанию (F2) ─────────────────────────────────────────
	//
	// Расписание — НАСТРОЙКА обслуживания: что делать, по каким базам и в каком окне. Его
	// прогоны становятся обычными заданиями, поэтому своего журнала здесь нет: итог по
	// каждой базе смотрят в «Заданиях», как и у ручных операций.
	//
	// Смотреть расписание может всякий, кому открыта панель; менять — только полный доступ
	// (см. onec/access.ts): ночная выгрузка занимает сервер часами.

	/** Разбор тела расписания: одно место на создание и на правку. */
	const parseSchedule = (
		req: Request, body: Record<string, unknown>, partial: boolean, existing?: MaintenanceSchedule | null,
	): { ok: true; value: Partial<MaintenanceSchedule> } | { ok: false; message: string } => {
		const out: Partial<MaintenanceSchedule> = {};

		if (body.name !== undefined || !partial) {
			const name = String(body.name ?? "").trim();
			if (!name) return { ok: false, message: "name: укажите название расписания" };
			out.name = name;
		}
		if (body.type !== undefined || !partial) {
			const type = String(body.type ?? "").toUpperCase();
			// Пускаем только то, что бывает пакетным: расписание ставит ровно такое же
			// задание, как кнопка в панели.
			if (!BATCHABLE.has(type)) return { ok: false, message: `type: так не бывает (${[...BATCHABLE].join(", ")})` };
			out.type = type;
		}
		if (body.baseKeys !== undefined || !partial) {
			const keys = Array.isArray(body.baseKeys)
				? body.baseKeys.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim())
				: [];
			if (!keys.length) return { ok: false, message: "baseKeys: не выбрано ни одной базы" };
			out.baseKeys = keys;
		}
		if (body.atTime !== undefined || !partial) {
			const at = String(body.atTime ?? "").trim();
			// Время — «ЧЧ:ММ» и ничего больше: секунды в окне обслуживания не значат ничего,
			// а свободный формат пришлось бы угадывать.
			if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) return { ok: false, message: "atTime: время в виде ЧЧ:ММ" };
			out.atTime = at;
		}
		// Сервер 1С расписания (C10): пусто — не назван; при нескольких серверах без него одноимённые базы
		// пропускаются с причиной. По умолчанию — сервер, выбранный в панели.
		if (body.serverId !== undefined) {
			const sid = typeof body.serverId === "string" && body.serverId.trim() ? body.serverId.trim() : null;
			if (sid && !UUID_RE.test(sid)) return { ok: false, message: "serverId: ожидается идентификатор сервера" };
			out.serverId = sid;
		} else if (!partial) {
			out.serverId = serverOf(req) ?? null;
		}
		if (body.weekdays !== undefined) {
			const days = Array.isArray(body.weekdays)
				? [...new Set(body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
				: [];
			out.weekdays = days.sort();
		} else if (!partial) {
			out.weekdays = [];
		}
		if (body.payload !== undefined) {
			out.payload = (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
				? body.payload : {}) as Record<string, unknown>;
		} else if (!partial) {
			out.payload = {};
		}
		if (body.enabled !== undefined) out.enabled = body.enabled !== false;
		else if (!partial) out.enabled = true;

		// Payload — по схеме команды и без секретов (С12): и при смене типа, и при смене payload.
		if (out.type !== undefined || out.payload !== undefined) {
			const type = out.type ?? existing?.type ?? "";
			const base = (out.baseKeys ?? existing?.baseKeys ?? [])[0] ?? "base";
			const problem = validateSchedulePayload(type, out.payload ?? existing?.payload ?? {}, base);
			if (problem) return { ok: false, message: problem };
		}

		return { ok: true, value: out };
	};

	r.get("/schedules", async (req, res) => {
		const u = req.erpUser!;
		const items = await schedules.list(u.organizationUuid ?? "");
		// «Пора» считается тем же правилом, что и в тике: панель показывает следующее окно
		// и не расходится с сервисом в том, запустится ли расписание сейчас.
		const now = new Date();
		res.json({
			success: true,
			data: { items: items.map((s) => ({ ...s, due: isDue(s, now) })) },
		});
	});

	r.post("/schedules", async (req, res) => {
		const u = req.erpUser!;
		const parsed = parseSchedule(req, (req.body ?? {}) as Record<string, unknown>, false);
		if (!parsed.ok) { send(res, fail(400, "VALIDATION_ERROR", parsed.message)); return; }

		const created = await schedules.create({
			organizationUuid: u.organizationUuid ?? "",
			userUuid: u.uuid,
			name: parsed.value.name!,
			type: parsed.value.type!,
			baseKeys: parsed.value.baseKeys!,
			payload: parsed.value.payload ?? {},
			serverId: parsed.value.serverId ?? null,
			atTime: parsed.value.atTime!,
			weekdays: parsed.value.weekdays ?? [],
			enabled: parsed.value.enabled ?? true,
		});
		await audit.write({
			event: "onec.schedule.create", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { id: created.id, name: created.name, type: created.type, bases: created.baseKeys.length, atTime: created.atTime },
		});
		res.status(201).json({ success: true, data: created });
	});

	r.patch("/schedules/:id", async (req, res) => {
		const u = req.erpUser!;
		const existing = await schedules.get(req.params.id);
		// Чужая организация — «не найдено»: сообщать о существовании чужой настройки незачем.
		if (!existing || existing.organizationUuid !== (u.organizationUuid ?? "")) {
			send(res, fail(404, "NOT_FOUND", "Расписание не найдено")); return;
		}
		const parsed = parseSchedule(req, (req.body ?? {}) as Record<string, unknown>, true, existing);
		if (!parsed.ok) { send(res, fail(400, "VALIDATION_ERROR", parsed.message)); return; }

		const saved = await schedules.update(existing.id, parsed.value);
		await audit.write({
			event: "onec.schedule.update", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { id: existing.id, changed: Object.keys(parsed.value) },
		});
		res.json({ success: true, data: saved });
	});

	r.delete("/schedules/:id", async (req, res) => {
		const u = req.erpUser!;
		const existing = await schedules.get(req.params.id);
		if (!existing || existing.organizationUuid !== (u.organizationUuid ?? "")) {
			send(res, fail(404, "NOT_FOUND", "Расписание не найдено")); return;
		}
		await schedules.remove(existing.id);
		await audit.write({
			event: "onec.schedule.delete", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { id: existing.id, name: existing.name },
		});
		res.json({ success: true, data: { id: existing.id } });
	});

	/**
	 * Запустить расписание СЕЙЧАС — не дожидаясь окна.
	 *
	 * Нужно ровно затем, зачем нужна проверка любой автоматики: убедиться, что ночью
	 * запустится то же самое и по тем же базам. Прогон настоящий: задание такое же, как
	 * ночное, и отметка прогона ставится — иначе запуск руками в окне обслуживания
	 * привёл бы ко второму, ночному прогону поверх первого.
	 */
	r.post("/schedules/:id/run", async (req, res) => {
		const u = req.erpUser!;
		const existing = await schedules.get(req.params.id);
		if (!existing || existing.organizationUuid !== (u.organizationUuid ?? "")) {
			send(res, fail(404, "NOT_FOUND", "Расписание не найдено")); return;
		}

		const started = await startBatch({ agents, queue, batches, bases }, {
			type: existing.type, baseKeys: existing.baseKeys, payload: existing.payload,
			organizationUuid: existing.organizationUuid, userUuid: u.uuid,
			// Сервер расписания (C10), а не выбранный сейчас в панели: ручной прогон должен идти туда же, куда ночной.
			serverId: existing.serverId, allowedServers: await allowedServers(req),
		});
		if (isBatchError(started)) { send(res, fail(400, "VALIDATION_ERROR", started.error)); return; }

		await schedules.markRun(existing.id, started.batchId);
		await audit.write({
			event: "onec.schedule.run", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { id: existing.id, name: existing.name, type: existing.type, batchId: started.batchId, total: started.total },
		});
		log.info({ scheduleId: existing.id, name: existing.name, batchId: started.batchId }, "обслуживание запущено вручную");
		res.status(202).json({ success: true, data: started });
	});

	/**
	 * Готовность команды — для опроса из панели после ответа 202. Отдаёт тот же конверт,
	 * что и синхронный путь: либо `{pending:true}`, либо результат, либо ошибку агента.
	 */
	r.get("/commands/:id", async (req, res) => {
		if (!(await agentVisible(req, (await queue.get(req.params.id))?.agent_id))) { send(res, fail(404, "NOT_FOUND", "Команда не найдена")); return; }
		// Просроченное закрываем здесь же: агент, который замолчал, этого не сделает, а
		// панель иначе опрашивает несуществующую работу до своего предела.
		await queue.expireOverdue();
		// И то, что ждёт агента, которого нет: забирать команду некому — ждать нечего.
		await queue.expireOrphaned(cfg.AGENT_OFFLINE_AFTER_SECS * 2);
		const row = await queue.get(req.params.id);
		if (!row) { send(res, fail(404, "NOT_FOUND", "Команда не найдена")); return; }
		if (row.state === "queued" || row.state === "dispatched") {
			// Ждать нечего, если исполнителя нет на связи: говорим об этом сразу, а не
			// через пятнадцать минут молчаливого опроса.
			const owner = await agents.findById(row.agent_id);
			const silentSecs = owner?.lastSeenAt
				? Math.floor((Date.now() - new Date(owner.lastSeenAt).getTime()) / 1000)
				: Number.MAX_SAFE_INTEGER;
			const agentOnline = silentSecs <= cfg.AGENT_OFFLINE_AFTER_SECS;
			/*
			 * СЛЕЖЕНИЕ ЗА ДОЛГОЙ ОПЕРАЦИЕЙ НЕ ОБРЫВАЕТСЯ МОЛЧАНИЕМ АГЕНТА (С20). Короткое ожидание получает отказ
			 * сразу — ждать некого. Но загрузка идёт часами, агент может перезапуститься или потерять связь на
			 * пару минут, а работа на сервере 1С продолжается: `?follow=1` получает «ещё идёт» с признаком
			 * «агент не на связи» и сколько он молчит, и панель продолжает следить.
			 */
			const follow = req.query.follow === "1";
			if (!agentOnline && !follow) {
				const silent = owner?.lastSeenAt ? ` (молчит ${silentSecs} с)` : "";
				send(res, fail(409, "AGENT_OFFLINE", row.state === "dispatched"
					// Забрал и замолчал — это не «забрать некому» (С20): работа могла идти или оборваться.
					? `Агент 1С забрал команду и перестал выходить на связь${silent}: она могла выполниться или прерваться `
						+ "вместе со службой. Итог придёт, когда агент вернётся; проверьте службу агента на сервере 1С."
					: `Агент 1С не на связи${silent}: команда поставлена в очередь, но забрать её некому. `
						+ "Проверьте службу агента на сервере 1С."));
				return;
			}
			/*
			 * ЧТО ПРОИСХОДИТ С КОМАНДОЙ (С20): ждёт очереди или выполняется и с какого времени, можно ли
			 * её прервать. Раньше ответ был одинаковым, и долгая проверка выглядела зависшей.
			 */
			const caps = owner?.capabilities ?? [];
			res.json({ success: true, data: {
				pending: true, commandId: row.id,
				state: row.state,
				agentOnline,
				...(agentOnline ? {} : { agentSilentSecs: silentSecs === Number.MAX_SAFE_INTEGER ? null : silentSecs }),
				queuedAt: new Date(row.created_at).toISOString(),
				// Когда агент начал и когда последний раз подтвердил работу (С33): «выполняется, агент подтверждает с …».
				startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
				runningConfirmedAt: row.running_seen_at ? new Date(row.running_seen_at).toISOString() : null,
				dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : null,
				abortable: isAbortable(row.state, row.type, {
					canCancel: caps.includes("agent.cancel"), canCancelCheck: caps.includes(CANCEL_CHECK_CAPABILITY),
				}, (row.payload ?? {}) as Record<string, unknown>),
			} });
			return;
		}
		if (row.state !== "done") {
			const e = humanizeAgentError(row.error, await authContext(row.base_key, await agents.findById(row.agent_id)))
				?? (row.state === "expired"
					// Текст просрочки записан в момент истечения — там ещё было известно,
					// забирал ли агент команду. Сюда попадаем, только если его почему-то нет.
					? { code: "COMMAND_EXPIRED", message: "Команда не выполнена: срок ожидания истёк." }
					: { code: "COMMAND_FAILED", message: "Команда не выполнена" });
			// 422 по той же причине, что и в run(): 5xx съедает прокси.
			res.status(422).json({ success: false, error: e });
			return;
		}
		// Списки содержимого базы кладутся в кэш на общем пути приёма (agentRouter),
		// здесь только отдаём готовое.
		// Проверка публикаций после ожидания отвечает так же, как сразу (С7).
		if (row.type === "CLUSTER_LIST_PUBLICATIONS") {
			res.json({ success: true, data: await publicationsAnswer(row.result) });
			return;
		}
		res.json({ success: true, data: row.result ?? null });
	});

	/*
	 * ТЕКУЩАЯ РАБОТА ПОЛЬЗОВАТЕЛЯ — одиночные команды и задания, которые ещё идут. Реестр операций панели живёт в
	 * памяти вкладки: после перезагрузки страницы или смены кэша «Прогресс» пустел, хотя работа шла. Панель по этому
	 * списку восстанавливает операции, как если бы только что их запустила, и дослеживает до конца. Только своё.
	 */
	r.get("/my-work", async (req, res) => {
		const u = req.erpUser!;
		const [cmds, own] = await Promise.all([queue.activeOfUser(u.uuid), batches.activeOfUser(u.uuid)]);
		res.json({ success: true, data: {
			commands: cmds.map((c) => {
				const spec = findAdminCommand(c.type);
				return {
					commandId: c.id, type: c.type, title: spec?.title ?? c.type, operation: spec?.operation ?? null,
					baseKey: c.base_key, state: c.state,
					createdAt: new Date(c.created_at).toISOString(),
					dispatchedAt: c.dispatched_at ? new Date(c.dispatched_at).toISOString() : null,
				};
			}),
			batches: own.map((b) => ({
				batchId: b.id, type: b.type, title: findAdminCommand(b.type)?.title ?? b.type, total: b.total,
				createdAt: new Date(b.created_at).toISOString(),
			})),
		} });
	});

	r.get("/batches", async (req, res) => {
		// Задания опрашивает панель, пока в них есть незавершённое, — здесь и закрываем то,
		// чему уже не суждено выполниться. Иначе групповая операция висела бы «в работе»
		// до истечения срока каждой команды, хотя службы агента давно нет.
		await queue.expireOverdue();
		await queue.expireOrphaned(cfg.AGENT_OFFLINE_AFTER_SECS * 2);
		res.json({ success: true, data: { items: await batches.list(req.erpUser!.organizationUuid ?? "") } });
	});

	/**
	 * Отменить команды, которые ещё не начаты.
	 *
	 * Отменяется только `queued` — см. queue.cancel: команду, которую агент уже забрал,
	 * останавливает не панель, а сам агент, и называть отменой прекращение ожидания
	 * значило бы врать о состоянии чужой системы.
	 */
	r.post("/commands/cancel", async (req, res) => {
		const asked = Array.isArray((req.body as { ids?: unknown })?.ids)
			? ((req.body as { ids: unknown[] }).ids).filter((x): x is string => typeof x === "string")
			: [];
		if (!asked.length) { send(res, fail(400, "VALIDATION_ERROR", "Не указано, что отменять")); return; }
		// Отменяем только свои: команда чужого агента — не наша очередь (C11).
		const ids: string[] = [];
		for (const id of asked) {
			const cmd = await queue.get(id);
			if (cmd && await agentVisible(req, cmd.agent_id)) ids.push(id);
		}
		const canceled = ids.length ? await queue.cancel(ids, req.erpUser!.uuid) : 0;
		res.json({ success: true, data: { canceled, asked: asked.length } });
	});

	/**
	 * ПРЕРВАТЬ НАЧАТУЮ КОМАНДУ (S4) — отмена, которую выполняет агент, а не очередь.
	 *
	 * Отмена выше снимает только не начатое. Начатая зависшая команда держит место
	 * внутрибазовых операций, и очередь по всем базам стоит до её срока. Прерываются только
	 * ЧТЕНИЯ: обрыв выгрузки, загрузки или обновления оставляет базу в промежуточном состоянии.
	 * Отмена адресуется агенту, который команду забрал. Закрывает прерванную команду сервис
	 * (queue.abort): агент по ней не ответит. Делается и здесь, и при приёме ответа агента —
	 * ответ на отмену может прийти позже, чем этот запрос ждёт.
	 */
	r.post("/commands/:id/abort", async (req, res) => {
		const cmd = await queue.get(req.params.id);
		if (!cmd || !(await agentVisible(req, cmd.agent_id))) { send(res, fail(404, "NOT_FOUND", "Команда не найдена")); return; }
		if (cmd.state === "queued") {
			send(res, fail(409, "COMMAND_NOT_STARTED", "Команда ещё не начата — используйте отмену до начала"));
			return;
		}
		if (cmd.state !== "dispatched") {
			send(res, fail(409, "COMMAND_FINISHED", "Команда уже завершена — прерывать нечего"));
			return;
		}
		if (!abortAllowed(cmd.type, (cmd.payload ?? {}) as Record<string, unknown>)) {
			send(res, fail(409, "ABORT_NOT_ALLOWED",
				"Прервать можно чтение и проверку базы без «Исправлять»: обрыв выгрузки, загрузки, обновления или "
				+ "исправления оставляет базу в промежуточном состоянии"));
			return;
		}
		// Проверку прерывает только агент, снимающий конфигуратор при отмене (С23, А21): иначе
		// осмотр продолжится вне учёта агента, а место базы освободится поверх работающего процесса.
		if (cmd.type === "IB_CHECK" && !(await agents.findById(cmd.agent_id))?.capabilities.includes(CANCEL_CHECK_CAPABILITY)) {
			send(res, fail(409, "ABORT_AGENT_OLD",
				"Эта сборка агента не умеет снимать конфигуратор при отмене проверки — дождитесь окончания проверки "
				+ "или обновите агента на сервере 1С"));
			return;
		}
		const force = (req.body as { force?: unknown } | undefined)?.force === true;
		const outcome = await run(req, "AGENT_CANCEL_COMMAND",
			{ commandId: cmd.id, ...(force ? { force: true } : {}) }, { agentId: cmd.agent_id });
		if (outcome.status !== 200) { send(res, outcome); return; }

		const answer = outcome.data as { ok?: boolean; killed?: boolean; note?: string; reason?: string } | null;
		if (answer?.ok === true) {
			const aborted = await queue.abort(cmd.id, req.erpUser!.uuid, answer.note ?? null);
			res.json({ success: true, data: { aborted, killed: answer.killed === true, note: answer.note ?? null } });
			return;
		}
		// NOT_RUNNING — команда успела закончиться сама: итог пришёл или придёт, это не ошибка.
		res.json({ success: true, data: { aborted: false, reason: answer?.reason ?? "NOT_RUNNING" } });
	});

	/** Остановить групповую операцию: отменяются все её команды, которые ещё не начаты. */
	r.post("/batches/:id/cancel", async (req, res) => {
		if (!(await batchVisible(req, req.params.id))) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }
		const canceled = await queue.cancelBatch(req.params.id, req.erpUser!.uuid);
		res.json({ success: true, data: { canceled } });
	});

	/**
	 * Повторить только неуспешные базы задания.
	 *
	 * Payload берём из САМИХ КОМАНД, а не из задания: в задании пароль и содержимое .cfe
	 * намеренно не хранятся (оно живёт в БД и попадает в журнал), а в команде payload
	 * полный — иначе повтор создания пользователя пришлось бы набирать заново.
	 */
	r.post("/batches/:id/retry", async (req, res) => {
		const u = req.erpUser!;
		const src = await batches.progress(req.params.id);
		if (!src) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }

		/*
		 * ПОВТОРЯЕМ ТО, ЧТО ОТМЕТИЛИ. Панель отмечает конкретные базы задания, и повтор
		 * обязан касаться их: без списка человек отмечал одну базу из десяти, а команда
		 * уходила во все десять — отметка была украшением. Пустой список означает «все
		 * неуспешные» (так работает кнопка, когда отмечено само задание целиком).
		 */
		const asked = (req.body as { baseKeys?: unknown } | undefined)?.baseKeys;
		const baseKeys = Array.isArray(asked)
			? asked.filter((k): k is string => typeof k === "string" && !!k.trim())
			: undefined;

		const failed = await batches.failedCommands(req.params.id, baseKeys);
		if (!failed.length) {
			send(res, fail(409, "NOTHING_TO_RETRY", baseKeys?.length
				? "Среди отмеченных баз нет неуспешных — повторять нечего"
				: "В задании нет неуспешных баз"));
			return;
		}

		if (!(await batchVisible(req, req.params.id))) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }
		const spec = findAdminCommand(src.type);
		if (!spec) { send(res, fail(400, "UNKNOWN_COMMAND", `Команда ${src.type} больше не поддерживается`)); return; }
		// Повтор — то же действие, что и задание: пользователи и расширения — по вложенным разрешениям, прочее — полный доступ.
		{
			const section = SECTION_OF_TYPE[src.type];
			if (section) {
				const need = { kind: "section" as const, ...section, bases: failed.length, type: src.type, baseKeys: [] };
				if (!sectionAllows(u.onec, section.section, section.action, failed.length)) {
					send(res, fail(403, "FORBIDDEN_ONEC_PERMISSION", deniedMessage(need, u.onec))); return;
				}
			} else if (!u.canOnecWrite) {
				send(res, fail(403, "FORBIDDEN_READONLY", "Доступ только на просмотр: для повтора нужно право «Администрирование 1С» с полным доступом"));
				return;
			}
		}

		const batchId = await batches.create({
			organizationUuid: u.organizationUuid ?? "",
			userUuid: u.uuid, type: src.type, payload: { retryOf: req.params.id }, total: failed.length,
		});

		let queued = 0;
		const skipped: { baseKey: string; reason: string }[] = [];
		for (const cmd of failed) {
			const key = cmd.base_key ?? "";
			const agent = await agents.pickAdminAgent(key || null, { serverId: cmd.server_id, allowedServers: await allowedServers(req) });
			if (!agent || !agentCanRun(agent, spec)) {
				skipped.push({ baseKey: key, reason: agent ? `нет способности ${spec.capability}` : "нет агента на связи" });
				continue;
			}
			const refusal = payloadRefusal(agent, spec, cmd.payload as Record<string, unknown>);
			if (refusal) { skipped.push({ baseKey: key, reason: refusal }); continue; }
			const fresh = await queue.enqueue({
				agentId: agent.id, organizationUuid: agent.organizationUuid, baseKey: cmd.base_key,
				type: cmd.type, payload: cmd.payload, userUuid: u.uuid,
				ttlSeconds: spec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS,
				queueWaitSeconds: BATCH_QUEUE_WAIT_SECS, inBase: runsInsideBase(spec), priority: 10,
			});
			await batches.attach(batchId, fresh.id);
			queued += 1;
		}
		await batches.noteSkipped(batchId, skipped.map((x) => ({ baseKey: x.baseKey, reason: x.reason })));
		await audit.write({ event: "onec.batch.retry", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { type: src.type, retryOf: req.params.id, total: failed.length, queued, skipped: skipped.length } });

		res.status(202).json({ success: true, data: { batchId, total: failed.length, queued, skipped } });
	});

	r.get("/batches/:id", async (req, res) => {
		if (!(await batchVisible(req, req.params.id))) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }
		const p = await batches.progress(req.params.id);
		if (!p) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }
		res.json({ success: true, data: p });
	});

	/**
	 * УЧЁТНАЯ ЗАПИСЬ ОТДЕЛЬНОЙ БАЗЫ.
	 *
	 * Агент знает одного администратора баз на всех; там, где он не подходит, база получает
	 * свою пару «пользователь + пароль». Пароль наружу не возвращается НИКОГДА — только
	 * признак «задан»: показывать его в панели незачем, а хранить в истории браузера вредно.
	 */
	r.get("/bases/:key/credentials", async (req, res) => {
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		const view = await credentials.describe(base.id, base.key);
		res.json({ success: true, data: view ?? { baseKey: base.key, user: "", hasPassword: false, updatedAt: null, updatedBy: null } });
	});

	r.put("/bases/:key/credentials", async (req, res) => {
		const body = (req.body ?? {}) as { user?: unknown; password?: unknown };
		const user = typeof body.user === "string" ? body.user.trim() : "";
		if (!user) { send(res, fail(400, "BAD_REQUEST", "Имя пользователя обязательно")); return; }
		if (user.length > 200) { send(res, fail(400, "BAD_REQUEST", "Имя пользователя слишком длинное")); return; }
		// Пароль не прислали — оставляем прежний: имя правят чаще, и требовать пароль заново
		// ради опечатки в имени значит однажды получить пустой пароль там, где он был.
		const password = body.password === undefined ? undefined
			: typeof body.password === "string" ? body.password : "";
		if (password !== undefined && password.length > 200) {
			send(res, fail(400, "BAD_REQUEST", "Пароль слишком длинный")); return;
		}
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		const u = req.erpUser!;
		await credentials.set(base.id, user, password, u.uuid);
		// В журнал — факт и имя пользователя. Пароль в журнал не попадает никогда.
		await audit.write({
			event: "onec.base.credentials.set", agentId: null, userUuid: u.uuid,
			details: { baseKey: base.key, user, passwordChanged: password !== undefined },
		});
		res.json({ success: true, data: await credentials.describe(base.id, base.key) });
	});

	r.delete("/bases/:key/credentials", async (req, res) => {
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		const u = req.erpUser!;
		const removed = await credentials.clear(base.id);
		if (removed) {
			await audit.write({
				event: "onec.base.credentials.clear", agentId: null, userUuid: u.uuid,
				details: { baseKey: base.key },
			});
		}
		res.json({ success: true, data: { removed } });
	});

	/**
	 * СКРЫТЬ БАЗУ ИЗ РАБОТЫ — решение администратора о базе-фантоме.
	 *
	 * ЗАЧЕМ. Бывает, что кластер базу перечисляет, а самой базы нет: `ibcmd` отвечает «База
	 * данных отсутствует в сервере баз данных». Запись в кластере осталась, данных нет;
	 * убрать регистрацию может только администратор на сервере 1С (агент такого не умеет и
	 * уметь не должен — это разрушающее действие над чужой системой). Но пока запись жива,
	 * база каждый раз попадает в списки, в отборы и в групповые команды и каждый раз
	 * отказывает одинаково.
	 *
	 * Скрытие — это отметка в реестре сервиса: «с этой базой не работаем». Срез кластера её
	 * не снимает и не ставит, данные базы не трогаются, решение обратимо. Снятая отметка
	 * возвращает базу в работу — например, после восстановления из копии.
	 */
	r.post("/bases/:key/hidden", async (req, res) => {
		const u = req.erpUser!;
		const hidden = (req.body as { hidden?: unknown } | undefined)?.hidden === true;
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		await bases.setDisabled(base.id, hidden);
		await audit.write({
			event: hidden ? "onec.base.hide" : "onec.base.unhide", agentId: null, userUuid: u.uuid,
			details: { baseKey: base.key },
		});
		res.json({ success: true, data: { ok: true, hidden } });
	});

	/**
	 * УБРАТЬ ИЗ РЕЕСТРА базу, которой нет в кластере (С45).
	 *
	 * Строка `MISSING` жила вечно: «Удалить регистрацию» ей бессмысленна (удалять в кластере нечего), скрытие
	 * оставляло её в реестре. Удаляем только такую — у базы, которая есть в кластере, отказ: её строку полный срез
	 * вернул бы через минуты, а человек решил бы, что удалил базу. В журнал — факт и ключ.
	 */
	r.delete("/bases/:key", async (req, res) => {
		const u = req.erpUser!;
		const base = await bases.findByKeyGlobal(req.params.key, await baseServerOf(req, req.params.key));
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		if (base.clusterStatus !== "MISSING") {
			send(res, fail(409, "BASE_IN_CLUSTER",
				`База «${base.key}» есть в кластере — из списка убирают только базы, регистрации которых в кластере нет. `
				+ "Чтобы убрать её с глаз, скройте базу"));
			return;
		}
		const removed = await bases.removeMissing(base.id);
		if (!removed) {
			// Между чтением и удалением срез вернул базе статус — сообщаем, а не делаем вид, что удалили.
			send(res, fail(409, "BASE_IN_CLUSTER", `База «${base.key}» снова появилась в кластере — список не изменён`));
			return;
		}
		await audit.write({
			event: "onec.base.remove", agentId: null, userUuid: u.uuid,
			details: { baseKey: base.key, serverName: base.serverName, hidden: base.disabled },
		});
		res.json({ success: true, data: { ok: true, removed: true } });
	});

	/**
	 * ОБСЛУЖИВАНИЕ БАЗЫ: проверка, загрузка из выгрузки, обновление конфигурации.
	 *
	 * Все три понимают `dryRun: true` — агент возвращает план и базу не трогает. Для
	 * разрушающих команд это готовый текст подтверждения: показать его человеку точнее,
	 * чем сочинять свой.
	 */
	r.post("/bases/:key/check", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "IB_CHECK", { ...body, baseKey: req.params.key }));
	});

	r.post("/bases/:key/restore", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "IB_RESTORE", { ...body, baseKey: req.params.key }));
	});

	r.post("/bases/:key/apply-update", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "IB_APPLY_UPDATE", { ...body, baseKey: req.params.key }));
	});

	/**
	 * ПРОЦЕССЫ, ЗАПУЩЕННЫЕ АГЕНТОМ на сервере 1С.
	 *
	 * Читаются из снимка, который агент шлёт с heartbeat: список обновляется сам раз в
	 * полминуты и не стоит ни одной команды. Живой опрос — отдельным вызовом, для кнопки
	 * «Обновить сейчас»: когда смотришь на зависший процесс, полминуты слишком долго.
	 */
	r.get("/agent-processes", async (req, res) => {
		// Процессы обеих ролей (выпуск агента 2026-09-20): бизнес-агент тоже запускает ibcmd и мост и сообщает их.
		const allowedProcs = await allowedServers(req);
		const orgsProcs = req.erpUser!.allowedOrgUuids;
		const visible = (await agents.listAll())
			.filter((a) => !allowedProcs || (a.role === "admin" ? !!a.serverId && allowedProcs.has(a.serverId) : orgsProcs.includes(a.organizationUuid)));

		if (req.query.live === "1") {
			/*
			 * «ОБНОВИТЬ СЕЙЧАС» СПРАШИВАЕТ ТОГО, ЧЬИ ПРОЦЕССЫ СМОТРЯТ (СП1). Раньше команда уходила без адресата, а
			 * исполнитель выбирался среди админ-агентов: на машине бухгалтера с одним бизнес-агентом кнопка отвечала
			 * «нет агента на связи», хотя его процессы были в таблице. Без `agentId` спрашиваем всех, кто на связи и
			 * умеет это (обе роли), и склеиваем ответы — один молчащий агент не прячет остальных.
			 */
			const asked = String((req.query as Record<string, unknown>).agentId ?? "").trim();
			const targets = visible.filter((a) => a.online && !a.disabled
				&& (a.capabilities.includes("agent.procs") || a.capabilities.includes("AGENT_LIST_PROCESSES"))
				&& (!asked || a.id === asked));
			if (!targets.length) { send(res, await run(req, "AGENT_LIST_PROCESSES", {}, asked ? { agentId: asked } : undefined)); return; }
			const answers = await Promise.all(targets.map(async (a) => ({ agent: a, outcome: await run(req, "AGENT_LIST_PROCESSES", {}, { agentId: a.id }) })));
			const ok = answers.filter((x) => x.outcome.status === 200);
			if (!ok.length) { send(res, answers[0].outcome); return; }
			const items = ok.flatMap((x) => ((x.outcome.data as { items?: Record<string, unknown>[] } | null)?.items ?? [])
				.map((p) => ({ ...p, agentId: x.agent.id, agentName: x.agent.name, agentRole: x.agent.role, seenAt: new Date().toISOString() })));
			send(res, { status: 200, body: { success: true, data: { items,
				// Кто не ответил — тоже ответ: иначе пустая таблица выглядит как «процессов нет».
				...(ok.length < answers.length ? { failed: answers.filter((x) => x.outcome.status !== 200).map((x) => ({ agentId: x.agent.id, agentName: x.agent.name, status: x.outcome.status })) } : {}),
			} }, data: { items } });
			return;
		}

		const items = visible
			.flatMap((a) => a.processes.map((p) => ({ ...p, agentId: a.id, agentName: a.name, agentRole: a.role, seenAt: a.processesSeenAt })));
		res.json({ success: true, data: { items } });
	});

	r.post("/agent-processes/:pid/kill", async (req, res) => {
		const pid = Number.parseInt(req.params.pid, 10);
		if (!Number.isFinite(pid) || pid <= 0) {
			send(res, fail(400, "BAD_REQUEST", "Некорректный номер процесса"));
			return;
		}
		const force = (req.body as { force?: unknown } | undefined)?.force === true;
		// Процесс — на машине конкретного агента (п. 7): без него снятие ушло бы первому агенту кластера, и при
		// нескольких серверах номер процесса указал бы на чужой процесс.
		const agentId = (req.body as { agentId?: unknown } | undefined)?.agentId;
		send(res, await run(req, "AGENT_KILL_PROCESS", { pid, force }, typeof agentId === "string" && UUID_RE.test(agentId) ? { agentId } : undefined));
	});

	/**
	 * УДАЛИТЬ МЁРТВУЮ РЕГИСТРАЦИЮ БАЗЫ ИЗ КЛАСТЕРА.
	 *
	 * Для базы-фантома это единственное настоящее лечение: скрытие лишь убирает её с глаз,
	 * а запись в кластере продолжает жить и мозолить глаза всем остальным инструментам.
	 * Данные команда не трогает — их и нет; проверяет это САМ АГЕНТ через СУБД и у живой
	 * базы отказывает (см. docs/TASK_SERVICE_DROP_INFOBASE.md). Отсюда и `confirm: true`:
	 * восстановить запись можно только вручную, со всеми параметрами подключения.
	 */
	r.post("/bases/:key/drop-registration", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "CLUSTER_DROP_INFOBASE", { ...body, baseKey: req.params.key }));
	});

	r.post("/bases/:key/lock", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "CLUSTER_SET_SESSIONS_LOCK", { ...body, baseKey: req.params.key }));
	});

	/*
	 * Запрет регламентных и фоновых заданий (С39). Отдельно от блокировки входа: она на фоновые задания не
	 * действует, а именно они держат базу разделённым доступом и срывают установку расширения.
	 */
	r.post("/bases/:key/scheduled-jobs", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "CLUSTER_SET_SCHEDULED_JOBS", { ...body, baseKey: req.params.key }));
	});

	// ── Заявки на подключение баз и токены баз (СВ4) ────────────────────────────────────────────────────────

	type ErpOrg = { uuid: string; name: string; bin: string | null };
	/** Организации ERP: для выбора при одобрении и для подсказки «чей БИН совпал». */
	const erpOrganizations = async (bins?: string[]): Promise<ErpOrg[]> => {
		const r = await erp.query<{ uuid: string; name: string | null; legal_name: string | null; bin: string | null }>(
			`SELECT uuid, name, "legalName" AS legal_name, bin FROM organizations
			  WHERE ($1::text[] IS NULL OR bin = ANY($1::text[]))
			  ORDER BY name LIMIT 1000`,
			[bins ?? null],
		);
		return r.rows.map((o) => ({ uuid: o.uuid, name: o.name || o.legal_name || o.uuid, bin: o.bin?.trim() || null }));
	};

	type BaseCandidate = { baseId: string; key: string; server: string };
	const registrationView = (row: RegistrationRow, orgs: ErpOrg[], candidates: BaseCandidate[]) => {
		const bins = row.body.organizations.map((o) => o.bin?.trim()).filter((b): b is string => !!b);
		const matched = orgs.filter((o) => o.bin && bins.includes(o.bin));
		return {
			id: row.id, code: row.code, state: row.state, note: row.note,
			base: row.body.base, user: row.body.user ?? null, contact: row.body.contact ?? null, comment: row.body.comment ?? null,
			organizations: row.body.organizations.map((o) => ({ ...o, erp: matched.find((m) => m.bin === o.bin?.trim()) ?? null })),
			ip: row.ip, repeats: row.repeats, createdAt: row.createdAt, expiresAt: row.expiresAt,
			decidedBy: row.decidedBy, decidedAt: row.decidedAt, organizationUuid: row.organizationUuid, baseKey: row.baseKey,
			tokenDelivered: !!row.tokenDeliveredAt,
			// Что предложить при одобрении: организацию ERP с тем же БИН и базу реестра с тем же ключом.
			suggestion: { organizationUuid: matched[0]?.uuid ?? null, baseKey: row.baseName, candidates },
		};
	};

	r.get("/registrations", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const q = req.query as Record<string, unknown>;
		const state = typeof q.state === "string" && ["PENDING", "APPROVED", "REJECTED", "EXPIRED"].includes(q.state) ? q.state as RegistrationState : null;
		const rows = await registrations.list({ state, q: typeof q.q === "string" ? q.q : null });
		const bins = [...new Set(rows.flatMap((x) => x.body.organizations.map((o) => o.bin?.trim()).filter((b): b is string => !!b)))];
		const orgs = bins.length ? await erpOrganizations(bins).catch(() => []) : [];
		const all = await bases.listAll();
		const candidatesOf = (key: string) => all.filter((b) => b.key.toLowerCase() === key.toLowerCase()).map((b) => ({ baseId: b.id, key: b.key, server: b.serverName }));
		res.json({ success: true, data: { items: rows.map((x) => registrationView(x, orgs, candidatesOf(x.baseName))), canDecide: !!req.erpUser!.isSuperAdmin } });
	});

	r.get("/erp-organizations", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Список организаций ERP открыт администратору BuhProf")); return; }
		res.json({ success: true, data: { items: await erpOrganizations() } });
	});

	/**
	 * Одобрить заявку — только администратор BuhProf: одобрение выдаёт базе доступ к сервису от имени организации ERP.
	 * База реестра: названная `baseId`; иначе единственная с этим ключом (при нескольких — на сервере из заявки);
	 * нет такой — заводится на сервере из заявки в организации ERP.
	 */
	r.post("/registrations/:id/approve", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Заявки на подключение одобряет только администратор BuhProf")); return; }
		const b = (req.body ?? {}) as { organizationUuid?: unknown; baseKey?: unknown; baseId?: unknown; note?: unknown };
		const organizationUuid = typeof b.organizationUuid === "string" ? b.organizationUuid.trim() : "";
		const baseKey = typeof b.baseKey === "string" ? b.baseKey.trim() : "";
		const baseId = typeof b.baseId === "string" && b.baseId.trim() ? b.baseId.trim() : null;
		const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
		if (!organizationUuid || !baseKey) { send(res, fail(400, "VALIDATION_ERROR", "Укажите организацию ERP и ключ базы в реестре")); return; }
		const reg = await registrations.get(String(req.params.id));
		if (!reg) { send(res, fail(404, "NOT_FOUND", "Заявка не найдена")); return; }
		if (reg.state !== "PENDING") { send(res, fail(409, "ALREADY_DECIDED", `Заявка уже ${reg.state === "EXPIRED" ? "просрочена" : "решена"}`)); return; }
		const org = (await erpOrganizations()).find((o) => o.uuid === organizationUuid);
		if (!org) { send(res, fail(400, "VALIDATION_ERROR", "Организация ERP не найдена")); return; }

		let target: BaseCandidate | null = null;
		const all = await bases.listAll();
		if (baseId) {
			const hit = all.find((x) => x.id === baseId);
			if (!hit) { send(res, fail(400, "VALIDATION_ERROR", "База реестра не найдена")); return; }
			target = { baseId: hit.id, key: hit.key, server: hit.serverName };
		} else {
			const same = all.filter((x) => x.key.toLowerCase() === baseKey.toLowerCase());
			const serverHint = (reg.body.base.server || reg.body.base.computer || "").toLowerCase();
			const onServer = same.filter((x) => x.serverName.toLowerCase() === serverHint);
			const pick = same.length === 1 ? same[0] : onServer.length === 1 ? onServer[0] : null;
			if (same.length > 1 && !pick) {
				res.status(409).json({ success: false, error: {
					code: "BASE_AMBIGUOUS", message: `База «${baseKey}» есть на нескольких серверах — выберите нужную`,
					details: { candidates: same.map((x) => ({ baseId: x.id, key: x.key, server: x.serverName })) },
				} });
				return;
			}
			if (pick) target = { baseId: pick.id, key: pick.key, server: pick.serverName };
		}
		if (!target) {
			// Базы в реестре нет (файловая, или сервер без админ-агента) — заводим её на сервере из заявки.
			const server = await bases.ensureServer(organizationUuid, reg.body.base.server || reg.body.base.computer || "1С");
			await bases.sync(server.id, [{ key: baseKey, name: reg.baseName } as BaseState], { complete: false, authoritative: false });
			const created = (await bases.listAll()).find((x) => x.serverId === server.id && x.key === baseKey);
			if (!created) { send(res, fail(500, "INTERNAL", "Не удалось завести базу в реестре")); return; }
			target = { baseId: created.id, key: created.key, server: server.name };
		}
		const ok = await registrations.approve(reg.id, { organizationUuid, baseId: target.baseId, baseKey: target.key, decidedBy: u.uuid, note });
		if (!ok) { send(res, fail(409, "ALREADY_DECIDED", "Заявка уже решена")); return; }
		// Организации базы (СВ2): их БИНы база вправе называть, запрашивая задачи и заметки. Список уже
		// пришёл в заявке; дальше база пополняет его сама. Сбой здесь не отменяет одобрение — база
		// перешлёт список при первом открытии чата.
		if (baseOrgs) {
			await baseOrgs.remember(target.baseId, reg.body.organizations ?? [])
				.catch((e: unknown) => log.warn({ err: e, baseId: target!.baseId }, "организации базы не сохранены"));
		}
		await audit.write({ event: "base.registration.approved", userUuid: u.uuid, organizationUuid,
			details: { registrationId: reg.id, code: reg.code, baseKey: target.key, server: target.server, baseId: target.baseId } });
		res.json({ success: true, data: { ok: true, baseKey: target.key, server: target.server } });
	});

	r.post("/registrations/:id/reject", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Заявки на подключение решает только администратор BuhProf")); return; }
		const note = String((req.body as { note?: unknown } | undefined)?.note ?? "").trim().slice(0, 1000);
		if (!note) { send(res, fail(400, "VALIDATION_ERROR", "Укажите причину отказа — её увидит администратор базы")); return; }
		const reg = await registrations.get(String(req.params.id));
		if (!reg) { send(res, fail(404, "NOT_FOUND", "Заявка не найдена")); return; }
		if (!(await registrations.reject(reg.id, { decidedBy: u.uuid, note }))) { send(res, fail(409, "ALREADY_DECIDED", "Заявка уже решена")); return; }
		await audit.write({ event: "base.registration.rejected", userUuid: u.uuid, details: { registrationId: reg.id, code: reg.code, note } });
		res.json({ success: true, data: { ok: true } });
	});

	/** Токены базы для карточки базы: кем и когда выпущены, отозваны ли. Сам токен не хранится и не показывается. */
	/*
	 * ТОКЕНЫ БАЗ: одной базы или ВСЕХ. Карточка базы спрашивает про себя (`baseId`), раздел «Расширение
	 * БухПроф-AI» — про все сразу: вопрос «каким базам вообще открыт чат» иначе решался обходом карточек.
	 * Кривой идентификатор — по-прежнему отказ: «не разобрали» не должно молча превращаться в «покажи всё».
	 */
	r.get("/base-tokens", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const baseId = String((req.query as Record<string, unknown>).baseId ?? "").trim();
		if (baseId && !/^[0-9a-f-]{36}$/i.test(baseId)) { send(res, fail(400, "VALIDATION_ERROR", "baseId: ожидается идентификатор базы")); return; }
		res.json({ success: true, data: { items: await baseTokens.list(baseId || null), canRevoke: !!req.erpUser!.isSuperAdmin } });
	});

	/*
	 * «Сменить токен» (§3 канала 1С): немедленная смена по подозрению на утечку — и она же руками, когда
	 * автоматическая (BASE_TOKEN_ROTATE_DAYS) выключена. Прежний токен остаётся годным на время перекрытия:
	 * база узнает новый в ответе на очередной ход и сохранит его сама. Оборвать связь сразу — это «Отозвать».
	 */
	r.post("/base-tokens/:id/rotate", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Токены баз меняет только администратор BuhProf")); return; }
		const id = String(req.params.id);
		// Сам токен — ни в ответ, ни в журнал: его получит только база, и только в ответе своего хода.
		if (!(await baseTokens.rotate(id, `user:${u.uuid}`))) { send(res, fail(404, "NOT_FOUND", "Токен не найден, отозван или уже сменён")); return; }
		await audit.write({ event: "base.token.rotated", userUuid: u.uuid, details: { tokenId: id } });
		res.json({ success: true, data: { ok: true } });
	});

	r.post("/base-tokens/:id/revoke", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Токены баз отзывает только администратор BuhProf")); return; }
		const id = String(req.params.id);
		if (!(await baseTokens.revoke(id, u.uuid))) { send(res, fail(404, "NOT_FOUND", "Токен не найден или уже отозван")); return; }
		await audit.write({ event: "base.token.revoked", userUuid: u.uuid, details: { tokenId: id } });
		res.json({ success: true, data: { ok: true } });
	});

	// ── Активация БИНов бизнес-агента (СВ4, часть 2) ───────────────────────────────────────────────────────

	/** БИНы, которые агент обслуживает сейчас по правилу «первые N» — основа списка, когда его ещё нет. */
	const servedBinsNow = async (agentId: string, limits: { maxBases: number | null; maxBins: number | null }): Promise<string[]> => {
		const v = describeAgentBases(await agentBases.list(agentId), { ...limits, activeBins: null });
		const out: string[] = [];
		for (const b of v.bases) for (const o of b.organizations ?? []) if (o.bin && !o.overLimit && !out.includes(o.bin)) out.push(o.bin);
		return out;
	};

	r.get("/activation-requests", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const q = req.query as Record<string, unknown>;
		const state = typeof q.state === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(q.state) ? q.state as ActivationState : null;
		const agentId = typeof q.agentId === "string" && /^[0-9a-f-]{36}$/i.test(q.agentId) ? q.agentId : null;
		const rows = await activation.list({ state, agentId });
		const all = await agents.listAll();
		const items = rows.map((x) => {
			const a = all.find((g) => g.id === x.agentId);
			const active = a?.limits.activeBins ?? null;
			return {
				...x, agentName: a?.name ?? null, agentOnline: a?.online ?? false,
				active: active ? active.includes(x.bin) : null,
				limits: a?.limits ?? null,
			};
		});
		res.json({ success: true, data: { items, canDecide: !!req.erpUser!.isSuperAdmin } });
	});

	/**
	 * Одобрить — БИН добавляется в список активных агента. Списка ещё не было — он заводится из того, что агент
	 * обслуживает сейчас, плюс этот БИН: иначе одобрение одного БИНа выключило бы все остальные. Больше `maxBins` —
	 * одобряется, но с предупреждением (тариф решает человек, а не сервис).
	 */
	r.post("/activation-requests/:agentId/:bin/approve", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Активацию БИНов одобряет только администратор BuhProf")); return; }
		const agentId = String(req.params.agentId);
		const bin = String(req.params.bin);
		const agent = await agents.findById(agentId);
		const q = agent ? await activation.get(agentId, bin) : null;
		if (!agent || !q) { send(res, fail(404, "NOT_FOUND", "Запрос активации не найден")); return; }
		if (q.state !== "PENDING") { send(res, fail(409, "ALREADY_DECIDED", "Запрос уже решён")); return; }
		const base = agent.limits.activeBins ?? await servedBinsNow(agent.id, agent.limits);
		const next = base.includes(bin) ? base : [...base, bin];
		await agents.setActiveBins(agent.id, next);
		const note = typeof (req.body as { note?: unknown } | undefined)?.note === "string" ? String((req.body as { note: string }).note).trim().slice(0, 1000) || null : null;
		await activation.decide(agent.id, bin, { state: "APPROVED", decidedBy: u.uuid, note });
		const overTariff = agent.limits.maxBins !== null && next.length > agent.limits.maxBins;
		await audit.write({ event: "agent.bin_activation.approved", agentId: agent.id, userUuid: u.uuid,
			details: { bin, activeBins: next.length, maxBins: agent.limits.maxBins, overTariff, initialized: !agent.limits.activeBins } });
		res.json({ success: true, data: {
			ok: true, activeBins: next,
			...(overTariff ? { warning: `Активных БИНов ${next.length} при тарифе ${agent.limits.maxBins} — проверьте тариф клиента` } : {}),
		} });
	});

	r.post("/activation-requests/:agentId/:bin/reject", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Активацию БИНов решает только администратор BuhProf")); return; }
		const note = String((req.body as { note?: unknown } | undefined)?.note ?? "").trim().slice(0, 1000);
		if (!note) { send(res, fail(400, "VALIDATION_ERROR", "Укажите причину отказа — её увидит клиент в окне агента")); return; }
		const agentId = String(req.params.agentId);
		const bin = String(req.params.bin);
		if (!(await activation.decide(agentId, bin, { state: "REJECTED", decidedBy: u.uuid, note }))) {
			send(res, fail(409, "ALREADY_DECIDED", "Запрос не найден или уже решён"));
			return;
		}
		await audit.write({ event: "agent.bin_activation.rejected", agentId, userUuid: u.uuid, details: { bin, note } });
		res.json({ success: true, data: { ok: true } });
	});

	/**
	 * ПЕРЕВОД ВСЕХ НА СПИСОК (C15). У агентов без списка активных БИНов записывается то, что они обслуживают сейчас:
	 * со списком порядок баз ничего не решает, и правило «первые N» — единственное место, где сервис и агент могут
	 * посчитать по-разному, — перестаёт действовать. Агенты со списком не трогаются.
	 */
	r.post("/active-bins/fix-all", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Активные БИНы меняет только администратор BuhProf")); return; }
		const targets = (await agents.listAll()).filter((a) => a.role === "business" && !a.disabled && !a.limits.activeBins);
		const done: { agentId: string; name: string; bins: number }[] = [];
		for (const a of targets) {
			const bins = await servedBinsNow(a.id, a.limits);
			// Агент ещё не прислал организаций (старая сборка) — фиксировать нечего: пустой список выключил бы всё.
			if (!bins.length) continue;
			await agents.setActiveBins(a.id, bins);
			done.push({ agentId: a.id, name: a.name, bins: bins.length });
		}
		await audit.write({ event: "agent.active_bins.fix_all", userUuid: u.uuid, details: { agents: done.length, skipped: targets.length - done.length } });
		res.json({ success: true, data: { fixed: done, skipped: targets.length - done.length } });
	});

	/**
	 * Список активных БИНов целиком (карточка агента): «Отключить» — список без БИН, «Зафиксировать текущие» — то,
	 * что агент обслуживает сейчас, `null` — вернуться к правилу «первые N».
	 */
	r.put("/agents/:id/active-bins", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Активные БИНы меняет только администратор BuhProf")); return; }
		const agent = await agents.findById(String(req.params.id));
		if (!agent) { send(res, fail(404, "NOT_FOUND", "Агент не найден")); return; }
		if (agent.role !== "business") { send(res, fail(409, "NOT_BUSINESS_AGENT", "Активные БИНы — у бизнес-агента")); return; }
		const body = (req.body ?? {}) as { bins?: unknown; fixCurrent?: unknown };
		let bins: string[] | null;
		if (body.fixCurrent === true) bins = await servedBinsNow(agent.id, agent.limits);
		else if (body.bins === null) bins = null;
		else if (Array.isArray(body.bins) && body.bins.length <= 1000 && body.bins.every((b) => typeof b === "string" && /^\S{1,20}$/.test(b.trim()))) bins = (body.bins as string[]).map((b) => b.trim());
		else { send(res, fail(400, "VALIDATION_ERROR", "bins: список БИН, null или fixCurrent: true")); return; }
		await agents.setActiveBins(agent.id, bins);
		await audit.write({ event: "agent.active_bins", agentId: agent.id, userUuid: u.uuid,
			details: { before: agent.limits.activeBins ?? null, after: bins } });
		res.json({ success: true, data: describeAgentBases(await agentBases.list(agent.id), { ...agent.limits, activeBins: bins }) });
	});

	// ── Подключение агентов по коду (СВ5) ──────────────────────────────────────────────────────────────────

	r.get("/enrollments", async (req, res) => {
		if (!sharedListsAllowed(req)) { send(res, fail(403, "FORBIDDEN", "Этот список открыт администратору BuhProf")); return; }
		const q = req.query as Record<string, unknown>;
		const state = typeof q.state === "string" && ["PENDING", "APPROVED", "REJECTED", "EXPIRED"].includes(q.state) ? q.state as EnrollmentState : null;
		const rows = await enrollments.list({ state, q: typeof q.q === "string" ? q.q : null });
		// Повторное подключение той же службы — тот же агент: панель показывает, кого заявка заменит.
		const items = await Promise.all(rows.map(async (x) => ({
			...x,
			previousAgentId: x.state === "PENDING" ? await enrollments.previousAgent(x.computer, x.serviceName, x.id) : null,
		})));
		res.json({ success: true, data: { items, canDecide: !!req.erpUser!.isSuperAdmin } });
	});

	/**
	 * Одобрить подключение агента — только администратор BuhProf: одобрение выдаёт службе токен доступа к сервису.
	 * Агент — названный `agentId`, иначе агент прежней заявки той же службы (переустановка), иначе новый. Роль и
	 * сервер агент сообщит сам при регистрации, как любой агент.
	 */
	r.post("/enrollments/:id/approve", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Подключение агентов одобряет только администратор BuhProf")); return; }
		const b = (req.body ?? {}) as { organizationUuid?: unknown; agentId?: unknown; name?: unknown; note?: unknown };
		const organizationUuid = typeof b.organizationUuid === "string" ? b.organizationUuid.trim() : "";
		const e = await enrollments.get(String(req.params.id));
		if (!e) { send(res, fail(404, "NOT_FOUND", "Заявка не найдена")); return; }
		if (e.state !== "PENDING") { send(res, fail(409, "ALREADY_DECIDED", `Заявка уже ${e.state === "EXPIRED" ? "просрочена" : "решена"}`)); return; }
		/*
		 * ОРГАНИЗАЦИЯ — ТОЛЬКО У БИЗНЕС-АГЕНТА. Он ходит в базы КОНКРЕТНОЙ организации ERP: по ней выбирается
		 * исполнитель команд чата и считается лимит тарифа. Админ-агент обслуживает КЛАСТЕР целиком — все базы всех
		 * клиентов сервера; исполнитель кластерных команд выбирается по серверу (pickAdminAgent), а доступ даёт право
		 * «Администрирование 1С», а не совпадение организации. Требовать организацию у такого агента значило бы
		 * спрашивать то, что ни на что не влияет, и выбранная «для галочки» организация вводила бы в заблуждение.
		 */
		if (!organizationUuid && e.role !== "admin") {
			send(res, fail(400, "VALIDATION_ERROR", "Укажите организацию ERP: бизнес-агент работает с базами одной организации"));
			return;
		}
		if (organizationUuid && !(await erpOrganizations()).some((o) => o.uuid === organizationUuid)) {
			send(res, fail(400, "VALIDATION_ERROR", "Организация ERP не найдена"));
			return;
		}
		const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 200) : e.name;
		/*
		 * ЧЕЙ АГЕНТ ДОСТАНЕТСЯ ЗАЯВКЕ. Явный `agentId` — как сказали; `null` — новый. Без указания берём агента
		 * прежней заявки той же службы, НО только если он сейчас не работает: имя компьютера и службы называет сам
		 * заявитель, и одобрение «по умолчанию» отдавало бы ему токен живого агента, а прежний токен умирал бы
		 * (аудит 21.09). Работающего агента можно занять только явным выбором в панели.
		 */
		let agentId = typeof b.agentId === "string" && UUID_RE.test(b.agentId) ? b.agentId
			: b.agentId === null ? null
				: await enrollments.previousAgent(e.computer, e.serviceName, e.id);
		let created = false;
		let reused = agentId ? await agents.findById(agentId) : null;
		if (agentId && !reused) agentId = null;
		const explicit = typeof b.agentId === "string";
		if (reused && !explicit && reused.online && !reused.disabled) {
			log.info({ enrollmentId: e.id, agentId: reused.id }, "заявка агента: прежний агент на связи — заводим нового");
			agentId = null;
			reused = null;
		}
		// Роль прежнего агента не меняется: бизнес-агент не станет агентом кластера повторной заявкой.
		if (reused && reused.role !== e.role) {
			send(res, fail(409, "AGENT_ROLE_MISMATCH",
				`Прежний агент этой службы — ${reused.role === "admin" ? "агент кластера" : "бизнес-агент"}, а заявка на другую роль. Выберите «новый агент»`));
			return;
		}
		if (!agentId) {
			// Токен нового агента не нужен: его выпустит выдача (rotate-token) — выпущенный здесь нигде не показывается.
			// Пустая организация у админ-агента — «не привязан»: так он и работает, по всему кластеру.
			// Роль — из заявки: дальше агент её не переназначит (см. AgentService.register).
			agentId = (await agents.create(organizationUuid, name, e.role)).agent.id;
			created = true;
		}
		/*
		 * ПОВТОРНОЕ ПОДКЛЮЧЕНИЕ ТОЙ ЖЕ СЛУЖБЫ приводит прежнего агента в соответствие с решением: иначе одобрение
		 * говорило бы одно, а агент оставался прежним. Отключённый включается (его только что одобрили заново),
		 * имя и организация берутся из заявки — у бизнес-агента организация решает, чьи команды он получает.
		 */
		if (reused) {
			if (reused.disabled) await agents.setDisabled(reused.id, false);
			if (name && name !== reused.name) await agents.rename(reused.id, name);
			if (e.role !== "admin" && organizationUuid && organizationUuid !== reused.organizationUuid) {
				await agents.setOrganization(reused.id, organizationUuid);
			}
			reused = await agents.findById(reused.id);
		}
		const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
		if (!(await enrollments.approve(e.id, { organizationUuid, agentId, decidedBy: u.uuid, note }))) {
			send(res, fail(409, "ALREADY_DECIDED", "Заявка уже решена"));
			return;
		}
		await audit.write({ event: "agent.enrollment.approved", agentId, userUuid: u.uuid, organizationUuid: organizationUuid || undefined,
			details: { enrollmentId: e.id, code: e.code, name, role: e.role, computer: e.computer, created,
				organizationUuid: organizationUuid || null, reusedAgent: !created } });
		res.json({ success: true, data: { ok: true, agentId, created } });
	});

	r.post("/enrollments/:id/reject", async (req, res) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin) { send(res, fail(403, "FORBIDDEN", "Подключение агентов решает только администратор BuhProf")); return; }
		const note = String((req.body as { note?: unknown } | undefined)?.note ?? "").trim().slice(0, 1000);
		if (!note) { send(res, fail(400, "VALIDATION_ERROR", "Укажите причину отказа — её увидят в окне агента")); return; }
		const e = await enrollments.get(String(req.params.id));
		if (!e) { send(res, fail(404, "NOT_FOUND", "Заявка не найдена")); return; }
		if (!(await enrollments.reject(e.id, { decidedBy: u.uuid, note }))) { send(res, fail(409, "ALREADY_DECIDED", "Заявка уже решена")); return; }
		await audit.write({ event: "agent.enrollment.rejected", userUuid: u.uuid, details: { enrollmentId: e.id, code: e.code, note } });
		res.json({ success: true, data: { ok: true } });
	});

	return r;
}
