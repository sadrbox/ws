// Администрирование 1С для панели aleppo.kz (E15/A3, A5-P0).
//
//   GET  /v1/onec/bases                      реестр баз (из БД, без обращения к кластеру)
//   POST /v1/onec/bases/refresh              перечитать список баз у админ-агента (rac)
//   GET  /v1/onec/bases/:key/info            сведения о базе
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

import { humanizeAgentError } from "../onec/errorHints.ts";
import { isDestructive } from "../onec/access.ts";
import { SECTION_OF_TYPE, agentsAllow, deniedMessage, onecRequirement, sectionAllows } from "../onec/permissions.ts";
import { BATCHABLE, BATCH_QUEUE_WAIT_SECS, isBatchError, startBatch } from "../onec/batchRunner.ts";
import { agentBuild, buildOutdated, missingFeatures } from "../agents/features.ts";
import { mergeDurationStats } from "../agents/commandStats.ts";
import { isDue, type MaintenanceSchedule, type ScheduleStore } from "../onec/schedules.ts";
import { Router, type Request, type Response } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireErpUser } from "../auth/index.ts";
import { rateLimit } from "./rateLimit.ts";
import type { AgentRole, AgentService } from "../agents/service.ts";
import { publicationReport, type BaseService, type BaseState, type PublicationItem } from "../bases/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import type { BatchService } from "../onec/batches.ts";
import type { IbExtension, IbUser, OnecRegistry } from "../onec/registry.ts";
import type { CredentialsStore } from "../onec/credentials.ts";
import {
	DEFAULT_COMMAND_TTL_SECS, LONG_COMMAND_TTL_SECS, type AdminCommandSpec, agentCanRun, buildAdminPayload, commandRequestId, findAdminCommand, payloadRefusal,
	runsInsideBase, validateSchedulePayload, abortAllowed, isAbortable, CANCEL_CHECK_CAPABILITY,
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
};

/** Итог админ-команды: HTTP-статус и тело в общем конверте {success, data|error}. */
type Outcome = { status: number; body: Record<string, unknown>; data?: unknown };

const fail = (status: number, code: string, message: string): Outcome =>
	({ status, body: { success: false, error: { code, message } } });

/** Способность агента: умеет входить в базу учётной записью из payload.auth. */
const CAP_BASE_AUTH = "ib.auth";

export function onecRouter(deps: Deps) {
	const { erp, cfg, log, agents, bases, queue, audit, batches, registry, credentials, schedules } = deps;
	const r = Router();

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
	r.use(async (req, res, next) => {
		try {
			const u = req.erpUser!;
			const need = onecRequirement(req.method, req.path, req.body);
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
		if (isDestructive(req.method, req.path, req.body) && !req.erpUser!.canOnecWrite) {
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
		if (built.baseKey && !(await bases.findByKeyGlobal(built.baseKey))) {
			return fail(404, "UNKNOWN_BASE",
				`Базы «${built.baseKey}» нет в реестре. Обновите список из кластера — возможно, она появилась или была удалена`);
		}

		const chosen = target ? await agents.findById(target.agentId) : await agents.pickAdminAgent(built.baseKey);
		const agent = chosen && !chosen.disabled ? chosen : null;
		if (!agent) return await explainNoAgent(built.baseKey, spec.role);
		if (!agentCanRun(agent, spec)) {
			// Разделяем два разных случая: агента не настроили на этот класс операций
			// (нет способности) — или он просто старее сервиса и такой команды не знает.
			const known = agent.capabilities.includes(spec.capability);
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
			return { status: 422, body: { success: false, error: e } };
		}
		return { status: 200, body: { success: true, data: done.result ?? null }, data: done.result ?? null };
	}

	/**
	 * Почему исполнителя нет. Один текст «не настроен или не на связи» на все случаи
	 * заводит в тупик: агент может быть жив и здоров, но принадлежать ДРУГОЙ организации
	 * — при AGENT_ORG_BINDING=strict он тогда невидим, и человеку не за что зацепиться.
	 * Разбираем ситуацию и называем её.
	 */
	async function explainNoAgent(baseKey: string | null, role: AgentRole): Promise<Outcome> {
		const all = (await agents.listAll()).filter((a) => !a.disabled && a.role === role);
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
		const items = await bases.listAll();
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
	const publicationsAnswer = async (raw: unknown) => {
		const data = raw as {
			items?: PublicationItem[]; complete?: boolean; source?: string; lookedIn?: string[];
		} | null;
		const items = Array.isArray(data?.items) ? data.items : [];
		const evidence = {
			source: typeof data?.source === "string" ? data.source : null,
			lookedIn: Array.isArray(data?.lookedIn) ? data.lookedIn.length : 0,
		};
		const report = publicationReport(items, data?.complete === true, evidence);
		return { items: await bases.listAll(), report: { ...report, ...evidence } };
	};

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
	r.post("/bases/refresh", async (req, res) => {
		const agent = await agents.pickAdminAgent(null);
		const outcome = await run(req, "CLUSTER_LIST_INFOBASES", {});
		if (outcome.status !== 200) {
			// 202 (команда ещё идёт), 422 (агент отказал), 409 (агента нет) — как есть.
			send(res, outcome);
			return;
		}
		const items = (outcome.data as { items?: BaseState[] } | null)?.items;
		// Пустой список НЕ применяем: полный срез с complete+authoritative пометил бы все
		// базы как пропавшие. Агент, вернувший ноль баз, скорее сломан, чем прав.
		if (agent?.serverId && Array.isArray(items) && items.length) {
			await bases.sync(agent.serverId, items, { complete: true, authoritative: true });
		}
		// Отвечаем ВСЕГДА реестром, а не сырым ответом rac: у них разная форма (у rac нет
		// ни сервера, ни счётчика расширений), и панель на сыром ответе рисовала пустые
		// колонки. Если применить было нечего — вернём то, что знаем сейчас.
		send(res, { status: 200, body: { success: true, data: { items: await bases.listAll() } } });
	});

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
		const base = await bases.findByKeyGlobal(req.params.key);
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		res.json({ success: true, data: { items: await registry.usersOfBase(base.id) } });
	});

	r.get("/bases/:key/users", async (req, res) => {
		const outcome = await run(req, "IB_LIST_USERS", { baseKey: req.params.key });
		await cacheList(req.params.key, outcome, (id, items) => registry.syncUsers(id, items as IbUser[]));
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
		const base = await bases.findByKeyGlobal(req.params.key);
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		res.json({ success: true, data: { items: await registry.extensionsOfBase(base.id) } });
	});

	r.get("/bases/:key/extensions", async (req, res) => {
		const outcome = await run(req, "IB_LIST_EXTENSIONS", { baseKey: req.params.key });
		await cacheList(req.params.key, outcome, (id, items) => registry.syncExtensions(id, items as IbExtension[]));
		send(res, outcome);
	});

	/** Общая часть двух ручек выше: успешный список → в кэш базы. */
	async function cacheList(
		key: string,
		outcome: Outcome,
		sync: (baseId: string, items: unknown[]) => Promise<void>,
	): Promise<void> {
		if (outcome.status !== 200) return;
		const items = (outcome.data as { items?: unknown[] } | null)?.items;
		if (!Array.isArray(items)) return;
		const base = await bases.findByKeyGlobal(key);
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
	r.get("/servers", async (_req, res) => {
		res.json({ success: true, data: { items: await bases.listServers() } });
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

		const ok = await bases.updateServer(req.params.id, {
			name: str("name"), publicHost: str("publicHost"), rasHost: str("rasHost"), rasPort: port,
		});
		if (!ok) { send(res, fail(404, "NOT_FOUND", "Сервер не найден")); return; }
		res.json({ success: true, data: { items: await bases.listServers() } });
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

	r.get("/agents/:id/health", async (req, res) => {
		send(res, await run(req, "AGENT_HEALTH", {}, { agentId: req.params.id }));
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

	r.get("/agents", async (_req, res) => {
		const all = await agents.listAll();
		// Экземпляры (процессы) агента: два процесса под одним токеном разбирают одну
		// очередь, и если их настройки разошлись — команды отказывают ЧЕРЕЗ РАЗ. Ни в одном
		// логе это не написано, поэтому показываем счёт прямо в панели.
		const items = await Promise.all(all.map(async (a) => ({
			id: a.id, name: a.name, role: a.role, online: a.online,
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
		if (!u.organizationUuid) { send(res, fail(409, "ORGANIZATION_REQUIRED", "Выберите активную организацию — к ней будет привязан агент")); return; }

		const { agent, token } = await agents.create(u.organizationUuid, name);
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
	r.get("/users", async (_req, res) => {
		res.json({ success: true, data: { items: await registry.userSummary() } });
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

	r.get("/extensions", async (_req, res) => {
		res.json({ success: true, data: { items: await registry.extensionSummary() } });
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

		const started = await startBatch({ agents, queue, batches }, {
			type, baseKeys: keys, payload: body.payload ?? {},
			organizationUuid: u.organizationUuid ?? "", userUuid: u.uuid,
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
		body: Record<string, unknown>, partial: boolean, existing?: MaintenanceSchedule | null,
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
		const parsed = parseSchedule((req.body ?? {}) as Record<string, unknown>, false);
		if (!parsed.ok) { send(res, fail(400, "VALIDATION_ERROR", parsed.message)); return; }

		const created = await schedules.create({
			organizationUuid: u.organizationUuid ?? "",
			userUuid: u.uuid,
			name: parsed.value.name!,
			type: parsed.value.type!,
			baseKeys: parsed.value.baseKeys!,
			payload: parsed.value.payload ?? {},
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
		const parsed = parseSchedule((req.body ?? {}) as Record<string, unknown>, true, existing);
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

		const started = await startBatch({ agents, queue, batches }, {
			type: existing.type, baseKeys: existing.baseKeys, payload: existing.payload,
			organizationUuid: existing.organizationUuid, userUuid: u.uuid,
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
		const ids = Array.isArray((req.body as { ids?: unknown })?.ids)
			? ((req.body as { ids: unknown[] }).ids).filter((x): x is string => typeof x === "string")
			: [];
		if (!ids.length) { send(res, fail(400, "VALIDATION_ERROR", "Не указано, что отменять")); return; }
		const canceled = await queue.cancel(ids, req.erpUser!.uuid);
		res.json({ success: true, data: { canceled, asked: ids.length } });
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
		if (!cmd) { send(res, fail(404, "NOT_FOUND", "Команда не найдена")); return; }
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
			const agent = await agents.pickAdminAgent(key || null);
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
		const base = await bases.findByKeyGlobal(req.params.key);
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
		const base = await bases.findByKeyGlobal(req.params.key);
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
		const base = await bases.findByKeyGlobal(req.params.key);
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
		const base = await bases.findByKeyGlobal(req.params.key);
		if (!base) { send(res, fail(404, "UNKNOWN_BASE", `Базы «${req.params.key}» нет в реестре`)); return; }
		await bases.setDisabled(base.id, hidden);
		await audit.write({
			event: hidden ? "onec.base.hide" : "onec.base.unhide", agentId: null, userUuid: u.uuid,
			details: { baseKey: base.key },
		});
		res.json({ success: true, data: { ok: true, hidden } });
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
		if (req.query.live === "1") {
			send(res, await run(req, "AGENT_LIST_PROCESSES", {}));
			return;
		}
		const items = (await agents.listAll())
			.filter((a) => a.role === "admin")
			.flatMap((a) => a.processes.map((p) => ({ ...p, agentId: a.id, agentName: a.name, seenAt: a.processesSeenAt })));
		res.json({ success: true, data: { items } });
	});

	r.post("/agent-processes/:pid/kill", async (req, res) => {
		const pid = Number.parseInt(req.params.pid, 10);
		if (!Number.isFinite(pid) || pid <= 0) {
			send(res, fail(400, "BAD_REQUEST", "Некорректный номер процесса"));
			return;
		}
		const force = (req.body as { force?: unknown } | undefined)?.force === true;
		send(res, await run(req, "AGENT_KILL_PROCESS", { pid, force }));
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

	return r;
}
