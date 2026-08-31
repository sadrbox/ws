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
	LLM_PROVIDER: z.enum(["anthropic", "openai", "ollama", "none"]).default("anthropic"),
	// OpenAI: ключ платформы (не подписка ChatGPT) и, для OpenAI-совместимых API, базовый URL.
	OPENAI_API_KEY: z.string().default(""),
	OPENAI_BASE_URL: z.string().default(""),
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
	// Привязка агентов к организациям ERP: strict — команды идут только агенту своей организации;
	// any — если у организации агента нет, берётся любой онлайн-агент (режим разработки на одном стенде).
	AGENT_ORG_BINDING: z.enum(["strict", "any"]).default("strict"),
	// §17: спрашивать подтверждение перед созданием документа (WRITE). CRITICAL — всегда.
	CONFIRM_WRITE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
	// Глубина рассуждений модели: извлечение намерения — не задача на xhigh.
	LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
	// Сколько ждать результат команды из 1С внутри одного хода диалога.
	CHAT_COMMAND_TIMEOUT_SECS: z.coerce.number().int().min(5).max(300).default(120),
	// Предел раундов «модель → инструменты» за один ход пользователя.
	CHAT_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(20).default(8),
	// Модель для чтения PDF выписок; по умолчанию — основная. Извлечение таблиц из многостраничных
	// PDF — задача, где точность важнее цены, поэтому отдельная переменная, а не «что подешевле».
	BANK_EXTRACT_MODEL: z.string().default(""),
	// Предел размера вложения PDF в чате (МБ). Anthropic принимает до 32 МБ и 100 страниц.
	CHAT_ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(30).default(20),
	// Сколько дней хранить файлы, отданные в диалоге (печатные формы, отчёты).
	FILE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
	// Сколько дней хранить диалоги (с сообщениями и файлами), выписки и завершённые команды.
	CONVERSATION_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
	// Лимиты на пользователя в минуту: ходы чата и ходы с вложениями (распознавание PDF — дорого). 0 — без лимита.
	RATE_LIMIT_CHAT_PER_MIN: z.coerce.number().int().min(0).max(1000).default(30),
	RATE_LIMIT_ATTACHMENTS_PER_MIN: z.coerce.number().int().min(0).max(100).default(6),
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
		llm: `${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL} effort=${cfg.LLM_EFFORT} confirmWrite=${cfg.CONFIRM_WRITE} bankExtract=${cfg.BANK_EXTRACT_MODEL || cfg.LLM_MODEL}`,
		anthropicKey: cfg.ANTHROPIC_API_KEY ? "задан" : "ПУСТО",
		openaiKey: cfg.OPENAI_API_KEY ? "задан" : "ПУСТО",
		openaiBaseUrl: cfg.OPENAI_BASE_URL || "(api.openai.com)",
		publicUrl: cfg.PUBLIC_URL,
		allowedOrigins: cfg.ALLOWED_ORIGINS,
		agentOrgBinding: cfg.AGENT_ORG_BINDING,
		retention: `files ${cfg.FILE_TTL_DAYS}d, conversations ${cfg.CONVERSATION_TTL_DAYS}d`,
		rateLimits: `chat ${cfg.RATE_LIMIT_CHAT_PER_MIN}/min, attachments ${cfg.RATE_LIMIT_ATTACHMENTS_PER_MIN}/min`,
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
