// BuhProf AI Service — точка входа.
//
// Сборка приложения вынесена в createApp(): тесты поднимают его без сетевого порта и без
// реального Anthropic. Запуск по сети — только в main().
//
// Маршруты:
//   GET  /health              открытый, для мониторинга и cloudflared
//   /agent/v1/*               агенты (Bearer agent token + X-Agent-Id)
//   /admin/v1/*               администратор (X-Admin-Key)
//   /v1/onec-chat/*           чат внутри 1С (X-Base-Token + X-1C-User-Id)
//   /v1/*                     пользователи ERP (JWT бэкенда)

import { EnrollmentStore } from "./agents/enrollments.ts";
import { BaseOrganizationsStore } from "./bases/organizations.ts";
import { ErpTasks } from "./erp/tasks.ts";
import { serverTools } from "./chat/serverTools.ts";
import { agentEnrollRouter } from "./http/agentEnrollRouter.ts";
import { ActivationStore } from "./agents/activation.ts";
import { RegistrationStore } from "./bases/registrations.ts";
import { baseRegistrationRouter } from "./http/baseRegistrationRouter.ts";
import { AgentBasesStore } from "./agents/agentBases.ts";
import express from "express";
import helmet from "helmet";
import type { Express, Request, Response, NextFunction } from "express";
import { loadConfig, describe, type Config } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createPools, type Db } from "./db/pool.ts";
import { migrate } from "./db/migrate.ts";
import { AgentService } from "./agents/service.ts";
import { BaseService } from "./bases/service.ts";
import { onecRouter } from "./http/onecRouter.ts";
import { BatchService } from "./onec/batches.ts";
import { OnecRegistry } from "./onec/registry.ts";
import { CommandQueue } from "./commands/queue.ts";
import { CredentialsStore } from "./onec/credentials.ts";
import { Audit } from "./audit/index.ts";
import { agentRouter } from "./http/agentRouter.ts";
import { adminRouter } from "./http/adminRouter.ts";
import { userRouter } from "./http/userRouter.ts";
import { onecChatRouter } from "./http/onecChatRouter.ts";
import { BaseTokenStore } from "./bases/tokens.ts";
import { TurnKeyStore } from "./chat/turnKeys.ts";
import { purgeOldData } from "./retention.ts";
import { ScheduleStore } from "./onec/schedules.ts";
import { runDueSchedules } from "./onec/maintenanceRunner.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { OpenAIProvider } from "./llm/openai.ts";
import { OpenAIBankExtractor } from "./bank/extract_openai.ts";
import type { StatementExtractor } from "./bank/extract.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { ChatWorkflow } from "./chat/workflow.ts";
import { BankExtractor } from "./bank/extract.ts";
import { StatementStore } from "./bank/store.ts";
import { FileStore } from "./files/store.ts";

export const VERSION = "0.4.0";

export type AppDeps = { cfg: Config; log: Logger; db: Db; erp: Db; llm?: LLMProvider | null; bank?: { extractor: BankExtractor; store: StatementStore } | null };

/** Провайдер LLM по конфигурации. `none` — сервис работает без чата (только агенты/админ). */
export function createProvider(cfg: Config, log: Logger): LLMProvider | null {
	if (cfg.LLM_PROVIDER === "anthropic") {
		if (!cfg.ANTHROPIC_API_KEY) {
			log.warn("LLM_PROVIDER=anthropic, но ANTHROPIC_API_KEY пуст — чат отключён");
			return null;
		}
		return new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.LLM_MODEL, effort: cfg.LLM_EFFORT });
	}
	if (cfg.LLM_PROVIDER === "openai") {
		if (!cfg.OPENAI_API_KEY) {
			log.warn("LLM_PROVIDER=openai, но OPENAI_API_KEY пуст — чат отключён");
			return null;
		}
		return new OpenAIProvider({ apiKey: cfg.OPENAI_API_KEY, model: openaiModel(cfg, cfg.LLM_MODEL, log), baseURL: cfg.OPENAI_BASE_URL || undefined, effort: cfg.LLM_EFFORT });
	}
	if (cfg.LLM_PROVIDER === "ollama") {
		log.warn("OllamaProvider ещё не реализован — чат отключён");
		return null;
	}
	return null;
}

/** Имя модели для OpenAI: LLM_MODEL по умолчанию — Claude, и с провайдером openai это было бы 404. */
function openaiModel(cfg: Config, model: string, log: Logger): string {
	if (/^claude/i.test(model)) {
		log.warn({ model }, "LLM_PROVIDER=openai, а модель — Claude; используется gpt-5 (задайте LLM_MODEL/BANK_EXTRACT_MODEL)");
		return "gpt-5";
	}
	return model;
}

/** Экстрактор PDF выписок по провайдеру; null — вложения в чате отключены. */
function createExtractor(cfg: Config, log: Logger): StatementExtractor | null {
	if (cfg.LLM_PROVIDER === "openai" && cfg.OPENAI_API_KEY) {
		return new OpenAIBankExtractor({ apiKey: cfg.OPENAI_API_KEY, model: openaiModel(cfg, cfg.BANK_EXTRACT_MODEL || cfg.LLM_MODEL, log), baseURL: cfg.OPENAI_BASE_URL || undefined });
	}
	if (cfg.ANTHROPIC_API_KEY) {
		return new BankExtractor({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.BANK_EXTRACT_MODEL || cfg.LLM_MODEL });
	}
	return null;
}

export function createApp(deps: AppDeps): { app: Express; queue: CommandQueue; agents: AgentService; workflow: ChatWorkflow | null } {
	const { cfg, log, db, erp } = deps;
	const agents = new AgentService(db, cfg.AGENT_OFFLINE_AFTER_SECS, cfg.AGENT_ORG_BINDING);
	// Режим `any` (C14) — для стенда разработки: команды и чат уходят агентам ЧУЖИХ организаций, если у своей агента нет.
	if (cfg.AGENT_ORG_BINDING === "any" && cfg.NODE_ENV === "production") {
		log.warn("AGENT_ORG_BINDING=any в production: команды организаций без своего агента уйдут агентам других организаций — нужен strict");
	}
	// Один реестр на оба роутера: списки из базы кладёт агентский путь, читает панель.
	const onecRegistry = new OnecRegistry(db);
	const baseRegistry = new BaseService(db);
	const queue = new CommandQueue(db, cfg.AGENT_IB_PARALLEL);
	// Учётные записи отдельных баз: ключ шифрования выводится из секрета сервиса, своей
	// переменной окружения не заводим — лишний секрет в .env это лишний способ потерять доступ.
	const credentials = new CredentialsStore(db, cfg.JWT_SECRET);
	const batches = new BatchService(db);
	const schedules = new ScheduleStore(db);
	// Пароль базы подставляется в команду ровно в момент выдачи агенту (см. queue.setAuthResolver).
	queue.setAuthResolver(async (agentId, baseKeys) => {
		const agent = await agents.findById(agentId);
		// Учётная запись администратора базы — только админ-агенту (C1): бизнес-команды теперь тоже несут базу в
		// очереди, и без этой проверки пароль администратора уходил бы службе, которой он не нужен.
		if (!agent?.serverId || agent.role !== "admin") return new Map();
		return credentials.forDispatch([agent.serverId], baseKeys);
	});
	const audit = new Audit(db, log);
	// Токены баз и заявки на подключение (СВ4): одни хранилища на канал 1С, регистрацию и панель.
	// Токены баз: секрет нужен для закрытой копии преемника при смене токена (§3 канала 1С).
	const baseTokens = new BaseTokenStore(db, cfg.JWT_SECRET, { rotateDays: cfg.BASE_TOKEN_ROTATE_DAYS, overlapHours: cfg.BASE_TOKEN_OVERLAP_HOURS });
	const turnKeys = new TurnKeyStore(db, cfg.ONEC_TURN_KEY_TTL_HOURS);
	const registrations = new RegistrationStore(db);
	// Задачи и заметки организации в чате 1С: хранит их ERP, сервис только посредничает
	// (план docs/PLAN_1C_TASKS_NOTES_2026-09-22.md). Без ERP_API_KEY канал выключен.
	const baseOrgs = new BaseOrganizationsStore(db);
	const erpTasks = new ErpTasks({ url: cfg.ERP_API_URL, key: cfg.ERP_API_KEY, timeoutMs: cfg.ERP_API_TIMEOUT_MS, log });
	const enrollments = new EnrollmentStore(db);
	const llm = deps.llm === undefined ? createProvider(cfg, log) : deps.llm;
	// Чтение PDF выписок — прямой вызов модели с документом на входе (Claude или OpenAI по
	// провайдеру); без ключа вложения в чате отключены, остальной чат работает.
	const extractor = deps.bank !== undefined ? null : createExtractor(cfg, log);
	const bank = deps.bank !== undefined ? deps.bank : extractor ? { extractor, store: new StatementStore(db) } : null;
	const files = new FileStore(db, cfg.FILE_TTL_DAYS);
	const workflow = llm
		? new ChatWorkflow({ db, log, llm, agents, queue, audit, confirmWrite: cfg.CONFIRM_WRITE,
			commandTimeoutMs: cfg.CHAT_COMMAND_TIMEOUT_SECS * 1000, maxToolRounds: cfg.CHAT_MAX_TOOL_ROUNDS, bank, files,
			serverTools: serverTools({ tasks: erpTasks, baseOrgs }),
			orgBin: async (uuid) => {
				const r = await erp.query<{ bin: string | null }>(`SELECT bin FROM organizations WHERE uuid = $1`, [uuid]);
				const bin = r.rows[0]?.bin?.trim() ?? "";
				return /^\d{12}$/.test(bin) ? bin : null;
			} })
		: null;
	// Просроченные файлы диалогов — при старте и раз в час.
	const purge = () => files.purgeExpired().then((n) => { if (n) log.info({ n }, "удалены просроченные файлы диалогов"); })
		// Ключи ходов 1С живут сутки: та же уборка, отдельной таблицей.
		.then(() => turnKeys.purgeExpired()).then((n) => { if (n) log.info({ n }, "удалены просроченные ключи ходов 1С"); })
		.catch((e) => log.warn({ err: e }, "очистка файлов"));
	void purge();
	setInterval(purge, 3_600_000).unref();
	// Старые диалоги, выписки и команды — при старте и раз в сутки.
	const retention = () => purgeOldData(db, cfg.CONVERSATION_TTL_DAYS)
		.then((r) => { if (r.conversations || r.statements || r.commands || r.audit) log.info(r, "удалены данные старше срока хранения"); })
		// Экземпляры агента копятся по строке на каждый перезапуск службы. Раньше их
		// чистило «когда повезёт» — попутно с чужим запросом; теперь это часть той же
		// суточной уборки, что и всё остальное.
		.then(() => agents.pruneInstances())
		.catch((e) => log.warn({ err: e }, "очистка старых данных"));
	void retention();
	setInterval(retention, 86_400_000).unref();

	// ── Обслуживание по расписанию (F2) ──────────────────────────────────────
	// Раз в минуту: окно назначают с точностью до минуты, а тик стоит одного запроса к
	// своей же БД. Решение «пора» и защита от двойного прогона — в onec/schedules.ts.
	// Первый проход НЕ на старте: сервис перезапускают днём, и отложенный на минуту тик
	// не отличим от обычного, зато не делает работу в момент запуска.
	const maintenance = () => runDueSchedules({ agents, queue, batches, bases: baseRegistry, schedules, audit, log })
		.then((r) => { if (r.started || r.failed) log.info(r, "расписание обслуживания: проход"); })
		.catch((e) => log.warn({ err: e }, "расписание обслуживания"));
	setInterval(maintenance, 60_000).unref();

	/*
	 * ПОСЛЕДНЯЯ СЕТКА ПОД ПРОМИСАМИ (аудит 21.09). Маршруты обёрнуты, но отказ может прийти из таймера или из
	 * фоновой задачи; по умолчанию Node роняет процесс, обрывая long-poll агентов и ожидание результатов. Пишем в
	 * журнал и продолжаем: служба, потерявшая одну операцию, полезнее остановленной.
	 */
	process.on("unhandledRejection", (reason) => {
		log.error({ err: reason instanceof Error ? reason.message : String(reason) }, "необработанный отказ промиса");
	});

	const app = express();
	app.disable("x-powered-by");
	// За cloudflared: реальный IP клиента — в X-Forwarded-For.
	app.set("trust proxy", true);
	app.use(helmet());
	// Вложения чата (PDF выписок, base64) идут в теле JSON: лимит — с запасом над CHAT_ATTACHMENT_MAX_MB × 3 файла.
	app.use(express.json({ limit: `${cfg.CHAT_ATTACHMENT_MAX_MB * 4 + 2}mb` }));

	// CORS — только для браузерного API /v1 и только для перечисленных origins. Агенты и
	// admin-вызовы идут не из браузера, им заголовки CORS ни к чему. Без библиотеки: правил
	// три строки, а лишняя зависимость — лишняя поверхность.
	app.use("/v1", (req, res, next) => {
		const origin = req.headers.origin;
		if (origin && cfg.ALLOWED_ORIGINS.includes(origin)) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
			// X-Onec-Server — выбранный в панели сервер 1С (C9): без него в списке браузер отменит запрос на preflight.
			res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Onec-Server");
			// Методы перечисляем ВСЕ, которые есть у браузерного API. Пропущенный метод
			// браузер не показывает как ошибку метода: предварительный запрос отвечает 204,
			// но без нужного метода в списке — и запрос отменяется с «CORS error», без
			// статуса и тела. Так молча не работали переименование и удаление агента
			// (PATCH/DELETE), пока то же самое не повторилось на учётной записи базы.
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
			res.setHeader("Access-Control-Max-Age", "600");
		}
		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}
		next();
	});

	app.get("/health", (_req, res) => {
		res.json({ success: true, data: { service: "buhprof-ai", version: VERSION, status: "ok", chat: !!workflow, timestamp: new Date().toISOString() } });
	});

	/*
	 * ХВОСТОВАЯ КОСАЯ ЧЕРТА — НЕ НОВЫЙ АДРЕС (А4, аудит 21.09). Проверки прав сравнивают путь с образцом, поэтому
	 * роутер панели строгий: `/bases/acme/lock/` там просто не существует. Чтобы старый клиент не получил 404 на
	 * ровном месте, приводим адрес к каноническому виду до маршрутизации — проверка при этом видит тот же путь,
	 * что и маршрут.
	 */
	app.use("/v1/onec", (req, _res, next) => {
		const [path, query] = req.url.split("?", 2);
		const trimmed = path.replace(/\/+$/, "");
		if (trimmed !== path && trimmed !== "") req.url = query === undefined ? trimmed : `${trimmed}?${query}`;
		next();
	});

	// Администрирование 1С (E15): отдельный префикс, своя проверка прав.
	app.use("/v1/onec", onecRouter({
		erp, cfg, log, agents, bases: baseRegistry, queue, audit,
		batches, registry: onecRegistry, credentials, schedules, agentBases: new AgentBasesStore(db), registrations, baseTokens, activation: new ActivationStore(db), enrollments, baseOrgs,
	}));
	// Подключение агента по коду (СВ5) — до agentRouter: у агента, который просит подключение, токена ещё нет.
	app.use("/agent/v1", agentEnrollRouter({ enrollments, agents, erp, audit, log }));
	app.use("/agent/v1", agentRouter({ db, cfg, log, agents, bases: baseRegistry, queue, audit, registry: onecRegistry }));
	app.use("/admin/v1", adminRouter({ cfg, log, agents, queue, audit, agentBases: new AgentBasesStore(db) }));
	// Регистрация базы (СВ4) — до канала чата: у базы, подающей заявку, токена ещё нет.
	app.use("/v1/onec-chat", baseRegistrationRouter({ registrations, tokens: baseTokens, erp, audit, log }));
	// Раньше /v1: у формы 1С нет JWT ERP, её субъект — токен базы.
	app.use("/v1/onec-chat", onecChatRouter({
		workflow, tokens: baseTokens, erp, log, version: VERSION, tasks: erpTasks, baseOrgs,
		maxAttachmentBytes: cfg.CHAT_ATTACHMENT_MAX_MB * 1048576, chatPerMin: cfg.RATE_LIMIT_CHAT_PER_MIN, attachmentsPerMin: cfg.RATE_LIMIT_ATTACHMENTS_PER_MIN,
		// Вложение отдельным запросом, ключ хода и смена токена базы: каждая часть включается своей
		// зависимостью, и GET /ping объявляет ровно то, что включено (features).
		files, turnKeys, rotation: baseTokens,
		rotationMinExtVersion: cfg.ONEC_EXT_ROTATION_MIN, minExtVersion: cfg.ONEC_EXT_MIN_VERSION,
		// Ссылки на задачи для 1С и отдельный лимит на изменяющие вызовы задач и заметок.
		panelUrl: cfg.PUBLIC_PANEL_URL, tasksWritePerMin: cfg.RATE_LIMIT_TASKS_WRITE_PER_MIN,
	}));
	app.use("/v1", userRouter({ erp, cfg, agents, workflow, log, files, version: VERSION, agentBases: new AgentBasesStore(db), db }));

	app.use((_req, res) => {
		res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ресурс не найден" } });
	});

	// Единый обработчик ошибок: наружу — обезличенно, в лог — целиком.
	app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
		const e = err as { type?: string; status?: number; message?: string };
		if (e?.type === "entity.parse.failed") {
			res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "Тело запроса не является корректным JSON" } });
			return;
		}
		log.error({ err, path: req.path, method: req.method }, "необработанная ошибка");
		res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } });
	});

	return { app, queue, agents, workflow };
}

async function main(): Promise<void> {
	const cfg = loadConfig();
	const log = createLogger(cfg.LOG_LEVEL);
	log.info({ version: VERSION, config: describe(cfg) }, "BuhProf AI Service запускается");

	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	await migrate(db, log);

	const { app, queue } = createApp({ cfg, log, db, erp });
	const server = app.listen(cfg.PORT, () => log.info({ port: cfg.PORT }, "слушаю"));
	// Long-poll агентов держит соединения до 30 с — таймауты сервера должны быть больше.
	server.keepAliveTimeout = 75_000;
	server.headersTimeout = 80_000;

	const shutdown = (signal: string) => {
		log.info({ signal }, "остановка");
		queue.close();
		server.close(() => {
			Promise.all([db.end(), erp.end()]).finally(() => process.exit(0));
		});
		setTimeout(() => process.exit(1), 10_000).unref();
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const isEntry = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href
	|| process.argv[1]?.endsWith("server.ts");
if (isEntry) {
	main().catch((err) => {
		console.error("FATAL:", err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
