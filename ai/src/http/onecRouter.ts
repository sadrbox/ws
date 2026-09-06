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
import { Router, type Request, type Response } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { requireErpUser } from "../auth/index.ts";
import { rateLimit } from "./rateLimit.ts";
import type { AgentRole, AgentService } from "../agents/service.ts";
import type { BaseService, BaseState } from "../bases/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import type { BatchService } from "../onec/batches.ts";
import type { IbExtension, IbUser, OnecRegistry } from "../onec/registry.ts";
import { type AdminCommandSpec, agentCanRun, buildAdminPayload, findAdminCommand } from "../commands/admin.ts";

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
};

/** Итог админ-команды: HTTP-статус и тело в общем конверте {success, data|error}. */
type Outcome = { status: number; body: Record<string, unknown>; data?: unknown };

const fail = (status: number, code: string, message: string): Outcome =>
	({ status, body: { success: false, error: { code, message } } });

export function onecRouter(deps: Deps) {
	const { erp, cfg, log, agents, bases, queue, audit, batches, registry } = deps;
	const r = Router();
	r.use(requireErpUser(erp, cfg.JWT_SECRET));

	// Предел частоты — на КЛАСТЕР: он один на всю установку, и защищать нужно именно его.
	// Раньше ключом была организация, но администрирование от организации не зависит —
	// иначе один и тот же rac дёргали бы N раз по числу организаций. Локальное чтение
	// реестра баз (GET /bases) не считается: оно отвечает из своей БД и до rac не доходит.
	r.use(rateLimit({
		max: cfg.RATE_LIMIT_ONEC_CLUSTER_PER_MIN,
		windowMs: 60_000,
		key: () => "onec-cluster",
		// Из-под лимита выведено то, что до кластера НЕ доходит и отвечает из своей БД:
		// реестр баз, опрос готовности команды (он идёт раз в 2 с и один в одиночку съел бы
		// половину минутной квоты), сводки по кэшу, задания и список агентов.
		applies: (req) => {
			if (req.method !== "GET") return true;
			return !(
				req.path === "/bases" ||
				req.path === "/agents" ||
				req.path === "/extensions" ||
				req.path === "/users" ||
				req.path.startsWith("/commands/") ||
				req.path.startsWith("/batches") ||
				req.path.startsWith("/users/")
			);
		},
		message: "Слишком часто обращаемся к кластеру 1С — подождите немного",
	}));

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
	 * Общий путь админ-команды: проверка payload → выбор админ-агента (по базе, если она
	 * указана) → гейт по capabilities → очередь → ожидание результата.
	 *
	 * Результат отдаётся синхронно: панель показывает сеансы здесь и сейчас, а не «команда
	 * поставлена». Если агент не ответил вовремя — это TIMEOUT, но команда ОСТАЁТСЯ в очереди
	 * и, скорее всего, выполнится; для CRITICAL текст говорит об этом прямо, иначе оператор
	 * повторит снятие сеанса, который уже снят.
	 */
	async function run(req: Request, type: string, input: unknown): Promise<Outcome> {
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

		const agent = await agents.pickAdminAgent(built.baseKey);
		if (!agent) return await explainNoAgent(built.baseKey, spec.role);
		if (!agentCanRun(agent, spec)) {
			// Разделяем два разных случая: агента не настроили на этот класс операций
			// (нет способности) — или он просто старее сервиса и такой команды не знает.
			const known = agent.capabilities.includes(spec.capability);
			return fail(409, "CAPABILITY_MISSING", known
				? `Агент не умеет команду «${spec.title}» (${spec.type}) — обновите агента на сервере 1С`
				: `Агент не умеет «${spec.title}»: нет способности ${spec.capability}`);
		}

		const cmd = await queue.enqueue({
			agentId: agent.id,
			// Команда принадлежит организации АГЕНТА (у неё сервер), а не активной
			// организации пользователя: журнал команд должен показывать, где выполнено.
			organizationUuid: agent.organizationUuid,
			baseKey: built.baseKey,
			type: spec.type,
			payload: built.payload,
			userUuid: u.uuid,
			ttlSeconds: 300,
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
			return { status: 202, body: { success: true, data: { pending: true, commandId: cmd.id } } };
		}
		if (done.state !== "done") {
			const e = humanizeAgentError(done.error) ?? { code: "COMMAND_FAILED", message: "Команда не выполнена" };
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

	r.get("/bases/:key/info", async (req, res) => {
		send(res, await run(req, "CLUSTER_INFOBASE_INFO", { baseKey: req.params.key }));
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
	r.get("/bases/:key/users", async (req, res) => {
		const outcome = await run(req, "IB_LIST_USERS", { baseKey: req.params.key });
		await cacheList(req.params.key, outcome, (id, items) => registry.syncUsers(id, items as IbUser[]));
		send(res, outcome);
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
	r.get("/agents", async (_req, res) => {
		const items = (await agents.listAll()).map((a) => ({
			id: a.id, name: a.name, role: a.role, online: a.online,
			capabilities: a.capabilities, lastSeenAt: a.lastSeenAt, disabled: a.disabled,
		}));
		res.json({ success: true, data: { items, limits: { checkParallel: cfg.ONEC_CHECK_PARALLEL } } });
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

	/** Где есть этот пользователь — ответ на «покажи его во всех базах». */
	r.get("/users/:name", async (req, res) => {
		res.json({ success: true, data: { items: await registry.findUser(req.params.name) } });
	});

	r.get("/extensions", async (_req, res) => {
		res.json({ success: true, data: { items: await registry.extensionSummary() } });
	});

	// ── Пакетные операции по выбранным базам (A4) ───────────────────────────────
	// Отвечаем СРАЗУ идентификатором задания, а не ждём сто подключений к 1С: панель
	// показывает прогресс опросом. Ждать здесь означало бы держать HTTP-запрос минуты.
	// Задание — только для ИЗМЕНЯЮЩИХ операций: их результат по каждой базе нужно хранить
	// и к нему возвращаться. Чтение (IB_LIST_*) идёт обычными запросами по выбранным базам:
	// нажал — увидел, заводить ради этого сущность и уходить на другую вкладку незачем.
	const BATCHABLE = new Set([
		"IB_CREATE_USER", "IB_DELETE_USER", "IB_INSTALL_EXTENSION", "IB_DELETE_EXTENSION",
		// Публикация — первый шаг раскатки: опубликовать → поставить расширение → перейти
		// на HTTP. Делать это по одной базе из ста бессмысленно.
		"IB_PUBLISH", "IB_UNPUBLISH",
	]);

	r.post("/batch", async (req, res) => {
		const u = req.erpUser!;
		const body = (req.body ?? {}) as { type?: string; baseKeys?: unknown; payload?: Record<string, unknown> };
		const type = String(body.type ?? "").toUpperCase();
		const keys = Array.isArray(body.baseKeys) ? body.baseKeys.filter((k): k is string => typeof k === "string" && !!k) : [];

		if (!BATCHABLE.has(type)) {
			send(res, fail(400, "UNKNOWN_COMMAND", `Пакетно выполняется только: ${[...BATCHABLE].join(", ")}`));
			return;
		}
		if (!keys.length) {
			send(res, fail(400, "VALIDATION_ERROR", "baseKeys: не выбрано ни одной базы"));
			return;
		}
		const spec = findAdminCommand(type)!;

		// Проверяем вход ОДИН раз на первой базе: payload у всех команд одинаков, кроме
		// ключа базы. Иначе сто одинаковых сообщений об одной и той же ошибке.
		const probe = buildAdminPayload(spec, { ...(body.payload ?? {}), baseKey: keys[0] });
		if (!probe.ok) {
			send(res, fail(400, "VALIDATION_ERROR", probe.message));
			return;
		}

		const batchId = await batches.create({
			organizationUuid: u.organizationUuid ?? "",
			userUuid: u.uuid,
			type,
			// Пароль в задание не пишем: оно живёт в БД и попадает в журнал.
			payload: Object.fromEntries(Object.entries(body.payload ?? {}).filter(([k]) => k !== "password" && k !== "contentBase64")),
			total: keys.length,
		});

		let queued = 0;
		const skipped: { baseKey: string; reason: string }[] = [];
		for (const key of keys) {
			const built = buildAdminPayload(spec, { ...(body.payload ?? {}), baseKey: key });
			if (!built.ok) { skipped.push({ baseKey: key, reason: built.message }); continue; }
			const agent = await agents.pickAdminAgent(key);
			if (!agent || !agentCanRun(agent, spec)) {
				skipped.push({ baseKey: key, reason: agent ? `нет способности ${spec.capability}` : "нет агента на связи" });
				continue;
			}
			const cmd = await queue.enqueue({
				agentId: agent.id, organizationUuid: agent.organizationUuid, baseKey: key,
				type: spec.type, payload: built.payload, userUuid: u.uuid, ttlSeconds: 900,
			});
			await batches.attach(batchId, cmd.id);
			queued += 1;
		}

		await audit.write({
			event: "onec.batch", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { type, total: keys.length, queued, skipped: skipped.length, title: spec.title },
		});
		log.info({ type, total: keys.length, queued, skipped: skipped.length, userUuid: u.uuid }, "пакетная команда 1С");

		res.status(202).json({ success: true, data: { batchId, total: keys.length, queued, skipped } });
	});

	/**
	 * Готовность команды — для опроса из панели после ответа 202. Отдаёт тот же конверт,
	 * что и синхронный путь: либо `{pending:true}`, либо результат, либо ошибку агента.
	 */
	r.get("/commands/:id", async (req, res) => {
		const row = await queue.get(req.params.id);
		if (!row) { send(res, fail(404, "NOT_FOUND", "Команда не найдена")); return; }
		if (row.state === "queued" || row.state === "dispatched") {
			res.json({ success: true, data: { pending: true, commandId: row.id } });
			return;
		}
		if (row.state !== "done") {
			const e = humanizeAgentError(row.error) ?? { code: "COMMAND_FAILED", message: "Команда не выполнена" };
			// 422 по той же причине, что и в run(): 5xx съедает прокси.
			res.status(422).json({ success: false, error: e });
			return;
		}
		// Списки содержимого базы кладутся в кэш на общем пути приёма (agentRouter),
		// здесь только отдаём готовое.
		res.json({ success: true, data: row.result ?? null });
	});

	r.get("/batches", async (req, res) => {
		res.json({ success: true, data: { items: await batches.list(req.erpUser!.organizationUuid ?? "") } });
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

		const failed = await batches.failedCommands(req.params.id);
		if (!failed.length) { send(res, fail(409, "NOTHING_TO_RETRY", "В задании нет неуспешных баз")); return; }

		const spec = findAdminCommand(src.type);
		if (!spec) { send(res, fail(400, "UNKNOWN_COMMAND", `Команда ${src.type} больше не поддерживается`)); return; }

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
			const fresh = await queue.enqueue({
				agentId: agent.id, organizationUuid: agent.organizationUuid, baseKey: cmd.base_key,
				type: cmd.type, payload: cmd.payload, userUuid: u.uuid, ttlSeconds: 900,
			});
			await batches.attach(batchId, fresh.id);
			queued += 1;
		}
		await audit.write({ event: "onec.batch.retry", organizationUuid: u.organizationUuid ?? undefined, userUuid: u.uuid,
			details: { type: src.type, retryOf: req.params.id, total: failed.length, queued, skipped: skipped.length } });

		res.status(202).json({ success: true, data: { batchId, total: failed.length, queued, skipped } });
	});

	r.get("/batches/:id", async (req, res) => {
		const p = await batches.progress(req.params.id);
		if (!p) { send(res, fail(404, "NOT_FOUND", "Задание не найдено")); return; }
		res.json({ success: true, data: p });
	});

	r.post("/bases/:key/lock", async (req, res) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		send(res, await run(req, "CLUSTER_SET_SESSIONS_LOCK", { ...body, baseKey: req.params.key }));
	});

	return r;
}
