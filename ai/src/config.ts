// Конфигурация из переменных окружения — с проверкой на старте.
//
// Сервис падает сразу, если чего-то не хватает: обнаружить пустой JWT_SECRET при первом
// запросе пользователя через неделю после деплоя — худший из вариантов. Секреты в логах
// не печатаются никогда: `describe()` отдаёт только безопасные поля.

import { z } from "zod";

const schema = z.object({
	PORT: z.coerce.number().int().min(1).max(65535).default(3100),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	DATABASE_URL: z.string().url(),
	ERP_DATABASE_URL: z.string().url(),
	JWT_SECRET: z.string().min(16, "JWT_SECRET слишком короткий"),
	ANTHROPIC_API_KEY: z.string().default(""),
	LLM_PROVIDER: z.enum(["anthropic", "ollama", "none"]).default("anthropic"),
	LLM_MODEL: z.string().default("claude-opus-5"),
	AGENT_ADMIN_KEY: z.string().min(16, "AGENT_ADMIN_KEY слишком короткий"),
	PUBLIC_URL: z.string().url().default("http://localhost:3100"),
	// Origins браузерных клиентов (ERP-фронт), через запятую. Агентам CORS не нужен.
	ALLOWED_ORIGINS: z.string().default("https://aleppo.kz,http://192.168.1.112:5173,http://localhost:5173,http://tauri.localhost")
		.transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean)),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
	// Сколько секунд держать long-poll агента максимум (сам агент просит wait=N).
	POLL_MAX_WAIT_SECS: z.coerce.number().int().min(1).max(60).default(30),
	// Агент считается офлайн, если heartbeat не приходил дольше этого.
	AGENT_OFFLINE_AFTER_SECS: z.coerce.number().int().min(10).default(90),
	// §17: спрашивать подтверждение перед созданием документа (WRITE). CRITICAL — всегда.
	CONFIRM_WRITE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
	// Глубина рассуждений модели: извлечение намерения — не задача на xhigh.
	LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
	// Сколько ждать результат команды из 1С внутри одного хода диалога.
	CHAT_COMMAND_TIMEOUT_SECS: z.coerce.number().int().min(5).max(300).default(120),
	// Предел раундов «модель → инструменты» за один ход пользователя.
	CHAT_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(20).default(8),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = schema.safeParse(env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Некорректная конфигурация:\n${issues}`);
	}
	return parsed.data;
}

/** Безопасное описание конфигурации для лога — без секретов. */
export function describe(cfg: Config): Record<string, unknown> {
	return {
		port: cfg.PORT,
		env: cfg.NODE_ENV,
		database: maskUrl(cfg.DATABASE_URL),
		erpDatabase: maskUrl(cfg.ERP_DATABASE_URL),
		llm: `${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL} effort=${cfg.LLM_EFFORT} confirmWrite=${cfg.CONFIRM_WRITE}`,
		anthropicKey: cfg.ANTHROPIC_API_KEY ? "задан" : "ПУСТО",
		publicUrl: cfg.PUBLIC_URL,
		allowedOrigins: cfg.ALLOWED_ORIGINS,
	};
}

function maskUrl(url: string): string {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.username || "?"}:***@${u.host}${u.pathname}`;
	} catch {
		return "<некорректный URL>";
	}
}
