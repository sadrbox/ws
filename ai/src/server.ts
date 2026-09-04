// BuhProf AI Service — точка входа.
//
// Сборка приложения вынесена в createApp(): тесты поднимают его без сетевого порта и без
// реального Anthropic. Запуск по сети — только в main().
//
// Маршруты:
//   GET  /health              открытый, для мониторинга и cloudflared
//   /agent/v1/*               агенты (Bearer agent token + X-Agent-Id)
//   /admin/v1/*               администратор (X-Admin-Key)
//   /v1/*                     пользователи ERP (JWT бэкенда)

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
import { Audit } from "./audit/index.ts";
import { agentRouter } from "./http/agentRouter.ts";
import { adminRouter } from "./http/adminRouter.ts";
import { userRouter } from "./http/userRouter.ts";
import { purgeOldData } from "./retention.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { OpenAIProvider } from "./llm/openai.ts";
import { OpenAIBankExtractor } from "./bank/extract_openai.ts";
import type { StatementExtractor } from "./bank/extract.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { ChatWorkflow } from "./chat/workflow.ts";
import { BankExtractor } from "./bank/extract.ts";
import { StatementStore } from "./bank/store.ts";
import { FileStore } from "./files/store.ts";

export const VERSION = "0.3.0";

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
	// Один реестр на оба роутера: списки из базы кладёт агентский путь, читает панель.
	const onecRegistry = new OnecRegistry(db);
	const baseRegistry = new BaseService(db);
	const queue = new CommandQueue(db);
	const audit = new Audit(db, log);
	const llm = deps.llm === undefined ? createProvider(cfg, log) : deps.llm;
	// Чтение PDF выписок — прямой вызов модели с документом на входе (Claude или OpenAI по
	// провайдеру); без ключа вложения в чате отключены, остальной чат работает.
	const extractor = deps.bank !== undefined ? null : createExtractor(cfg, log);
	const bank = deps.bank !== undefined ? deps.bank : extractor ? { extractor, store: new StatementStore(db) } : null;
	const files = new FileStore(db, cfg.FILE_TTL_DAYS);
	const workflow = llm
		? new ChatWorkflow({ db, log, llm, agents, queue, audit, confirmWrite: cfg.CONFIRM_WRITE,
			commandTimeoutMs: cfg.CHAT_COMMAND_TIMEOUT_SECS * 1000, maxToolRounds: cfg.CHAT_MAX_TOOL_ROUNDS, bank, files })
		: null;
	// Просроченные файлы диалогов — при старте и раз в час.
	const purge = () => files.purgeExpired().then((n) => { if (n) log.info({ n }, "удалены просроченные файлы диалогов"); }).catch((e) => log.warn({ err: e }, "очистка файлов"));
	void purge();
	setInterval(purge, 3_600_000).unref();
	// Старые диалоги, выписки и команды — при старте и раз в сутки.
	const retention = () => purgeOldData(db, cfg.CONVERSATION_TTL_DAYS)
		.then((r) => { if (r.conversations || r.statements || r.commands) log.info(r, "удалены данные старше срока хранения"); })
		.catch((e) => log.warn({ err: e }, "очистка старых данных"));
	void retention();
	setInterval(retention, 86_400_000).unref();

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
			res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

	// Администрирование 1С (E15): отдельный префикс, своя проверка прав.
	app.use("/v1/onec", onecRouter({
		erp, cfg, log, agents, bases: baseRegistry, queue, audit,
		batches: new BatchService(db), registry: onecRegistry,
	}));
	app.use("/agent/v1", agentRouter({ db, cfg, log, agents, bases: baseRegistry, queue, audit, registry: onecRegistry }));
	app.use("/admin/v1", adminRouter({ cfg, log, agents, queue, audit }));
	app.use("/v1", userRouter({ erp, cfg, agents, workflow, log, files, version: VERSION }));

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
