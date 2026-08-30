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
import { CommandQueue } from "./commands/queue.ts";
import { Audit } from "./audit/index.ts";
import { agentRouter } from "./http/agentRouter.ts";
import { adminRouter } from "./http/adminRouter.ts";
import { userRouter } from "./http/userRouter.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { ChatWorkflow } from "./chat/workflow.ts";

export const VERSION = "0.1.0";

export type AppDeps = { cfg: Config; log: Logger; db: Db; erp: Db; llm?: LLMProvider | null };

/** Провайдер LLM по конфигурации. `none` — сервис работает без чата (только агенты/админ). */
export function createProvider(cfg: Config, log: Logger): LLMProvider | null {
	if (cfg.LLM_PROVIDER === "anthropic") {
		if (!cfg.ANTHROPIC_API_KEY) {
			log.warn("LLM_PROVIDER=anthropic, но ANTHROPIC_API_KEY пуст — чат отключён");
			return null;
		}
		return new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.LLM_MODEL, effort: cfg.LLM_EFFORT });
	}
	if (cfg.LLM_PROVIDER === "ollama") {
		log.warn("OllamaProvider ещё не реализован — чат отключён");
		return null;
	}
	return null;
}

export function createApp(deps: AppDeps): { app: Express; queue: CommandQueue; agents: AgentService; workflow: ChatWorkflow | null } {
	const { cfg, log, db, erp } = deps;
	const agents = new AgentService(db, cfg.AGENT_OFFLINE_AFTER_SECS);
	const queue = new CommandQueue(db);
	const audit = new Audit(db, log);
	const llm = deps.llm === undefined ? createProvider(cfg, log) : deps.llm;
	const workflow = llm
		? new ChatWorkflow({ db, log, llm, agents, queue, audit, confirmWrite: cfg.CONFIRM_WRITE,
			commandTimeoutMs: cfg.CHAT_COMMAND_TIMEOUT_SECS * 1000, maxToolRounds: cfg.CHAT_MAX_TOOL_ROUNDS })
		: null;

	const app = express();
	app.disable("x-powered-by");
	// За cloudflared: реальный IP клиента — в X-Forwarded-For.
	app.set("trust proxy", true);
	app.use(helmet());
	app.use(express.json({ limit: "2mb" }));

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

	app.use("/agent/v1", agentRouter({ db, cfg, log, agents, queue, audit }));
	app.use("/admin/v1", adminRouter({ cfg, log, agents, queue, audit }));
	app.use("/v1", userRouter({ erp, cfg, agents, workflow, log }));

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
