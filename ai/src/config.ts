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
	/**
	 * Служебный канал ERP (/bpai): задачи и заметки организации для чата внутри 1С. Пустой ключ —
	 * канал выключен: чат работает как прежде, а задачи и заметки недоступны с внятным отказом,
	 * а не с пятисоткой. Ключ тот же, что BPAI_API_KEY в backend/.env.
	 */
	ERP_API_URL: z.string().default("http://127.0.0.1:5000"),
	ERP_API_KEY: z.string().default(""),
	ERP_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
	PUBLIC_URL: z.string().url().default("http://localhost:3100"),
	// Origins браузерных клиентов (ERP-фронт), через запятую. Агентам CORS не нужен.
	ALLOWED_ORIGINS: z.string().default("https://aleppo.kz,http://192.168.1.112:5173,http://localhost:5173,http://tauri.localhost")
		.transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean)),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
	// Сколько секунд держать long-poll агента максимум (сам агент просит wait=N).
	POLL_MAX_WAIT_SECS: z.coerce.number().int().min(1).max(60).default(30),
	// Агент считается офлайн, если heartbeat не приходил дольше этого.
	AGENT_OFFLINE_AFTER_SECS: z.coerce.number().int().min(10).default(90),
	/**
	 * Сколько команд ВНУТРЬ БАЗ разрешено выдать одному агенту одновременно.
	 *
	 * Измерено 2026-09-11: две параллельные команды `IB_LIST_EXTENSIONS` (разные базы)
	 * заклинили агента больше чем на двенадцать минут — ответа нет, heartbeat прекратился.
	 * Та же команда в одиночку честно отвечала отказом через 186 с. Похоже на общий ресурс
	 * внутри агента (`ibcmd` и его рабочий каталог), но чинить это ему, а нам — не подавать
	 * ему того, чего он не переваривает.
	 *
	 * Это ЗАЩИТА, а не политика: как агент докажет, что умеет больше, значение поднимают
	 * настройкой, без правки кода. Команд кластера (rac) ограничение не касается вовсе —
	 * они быстрые и в базы не заходят.
	 */
	AGENT_IB_PARALLEL: z.coerce.number().int().min(1).max(16).default(1),
	/**
	 * То же для БИЗНЕС-агента (19.09). С тех пор как команды чата несут базу в очереди (C1), на них действует
	 * предел внутрибазовых команд — а у многобазового агента один на все базы. Команды одной базы по-прежнему идут
	 * по одной; этот предел — сколько РАЗНЫХ баз агент обслуживает одновременно. Команды чата лёгкие (поиск,
	 * документ), конфигуратора и выгрузок у бизнес-агента нет — поэтому по умолчанию больше, чем у админ-агента.
	 */
	BUSINESS_IB_PARALLEL: z.coerce.number().int().min(1).max(32).default(4),
	/**
	 * Кто видит какие серверы 1С в панели (C11). `all` — все, кому открыта панель (сервер один на установку, как
	 * было); `organizations` — не суперадмин видит только серверы своих организаций ERP: у клиентов BuhProf свои
	 * серверы, и чужие им видеть незачем.
	 */
	ONEC_SERVER_SCOPE: z.enum(["all", "organizations"]).default("all"),
	/**
	 * Откуда агент берёт новую сборку при обновлении из панели (задача агенту §2). Адрес — https и хост, который
	 * агент считает своим; `{build}` в адресе заменяется на сборку. Пусто — панель попросит адрес и хэш руками.
	 */
	AGENT_UPDATE_URL: z.string().max(1000).optional(),
	/** SHA-256 сборки по адресу выше: агент сверяет его перед установкой. */
	AGENT_UPDATE_SHA256: z.string().max(100).optional(),
	/**
	 * Сборка агента-эталон (R3), например «2026-09-14 23:16»: меняется, когда выпущена новая сборка.
	 * Агент старше отмечается в панели «Устарел». Не задано — отметки нет: сравнивать не с чем.
	 */
	AGENT_LATEST_BUILD: z.string().max(40).optional(),
	// Как часто агент присылает ПОЛНЫЙ срез по базам (E15/A2). Между полными срезами — только
	// изменения: сто баз каждые 30 секунд — это лишний трафик и лишние обращения к кластеру.
	// Решение принимает сервер и сообщает его в ответе на heartbeat, поэтому интервал меняется
	// без переустановки службы на сервере 1С.
	AGENT_BASES_FULL_EVERY_SECS: z.coerce.number().int().min(30).max(3600).default(300),
	// Привязка агентов к организациям ERP: strict — команды идут только агенту своей организации;
	// any — если у организации агента нет, берётся любой онлайн-агент (режим разработки на одном стенде).
	AGENT_ORG_BINDING: z.enum(["strict", "any"]).default("strict"),
	// §17: спрашивать подтверждение перед созданием документа (WRITE). CRITICAL — всегда.
	CONFIRM_WRITE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
	// Глубина рассуждений модели: извлечение намерения — не задача на xhigh.
	LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
	// Сколько ждать результат команды из 1С внутри одного хода диалога.
	CHAT_COMMAND_TIMEOUT_SECS: z.coerce.number().int().min(5).max(300).default(120),
	/**
	 * Сколько ждать результат админ-команды в HTTP-запросе панели.
	 *
	 * ДОЛЖЕН БЫТЬ ЗАМЕТНО МЕНЬШЕ ЛИМИТА ПРОКСИ. Иначе запрос
	 * переживает прокси, тот обрывает его СВОИМ ответом — без заголовков CORS, — и браузер
	 * показывает «Access-Control-Allow-Origin missing» вместо внятной ошибки. Измерено:
	 * вход в базу занимает у агента от 20 с до 15 минут, так что ждать «сколько получится»
	 * нельзя в принципе.
	 *
	 * Не дождались — отвечаем 202 с идентификатором команды, и клиент опрашивает её
	 * готовность короткими запросами. Так ни один HTTP-запрос не живёт дольше этого
	 * значения, и обрыв на прокси (ответ без заголовков CORS — браузер показывает его как
	 * «Access-Control-Allow-Origin missing») становится невозможным в принципе.
	 * Точный лимит туннеля знать при этом не нужно: достаточно быть заведомо ниже любого.
	 */
	ONEC_COMMAND_TIMEOUT_SECS: z.coerce.number().int().min(5).max(90).default(20),
	/**
	 * Сколько баз опрашивать ОДНОВРЕМЕННО при групповой проверке из панели.
	 *
	 * Единственный источник этого числа: раньше оно было зашито во фронте, а у агента —
	 * своё `max_parallel`, и два независимых значения расходились. Каждое обращение к базе
	 * занимает у 1С сеанс и лицензию: измеренный потолок ставится здесь, панель его читает.
	 */
	ONEC_CHECK_PARALLEL: z.coerce.number().int().min(1).max(16).default(4),
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
	// Предел обращений к КЛАСТЕРУ 1С в минуту — на сам кластер (E15/A6): он один на
	// установку, администрирование от организации не зависит, и ключ-по-организации
	// означал бы N-кратный опрос одного и того же rac.
	// у сотни баз один кластер, и три администратора с открытой панелью сеансов дают тройную
	// нагрузку на rac. Локальное чтение реестра баз сюда не входит — оно не трогает кластер.
	RATE_LIMIT_ONEC_CLUSTER_PER_MIN: z.coerce.number().int().min(0).max(600).default(60),
	// ── Канал «расширение 1С ↔ сервис» (TASK_SERVICE_ONEC_CHAT_CHANNEL_2026-09-21) ──
	// Через сколько дней токен базы меняется сам. 0 — только по кнопке «Сменить токен» в панели.
	// Смену получает лишь расширение, умеющее её сохранить (ONEC_EXT_ROTATION_MIN), — остальные не трогаем.
	BASE_TOKEN_ROTATE_DAYS: z.coerce.number().int().min(0).max(3650).default(90),
	// Сколько прежний токен принимается после смены: расширение сохраняет новый не мгновенно.
	BASE_TOKEN_OVERLAP_HOURS: z.coerce.number().int().min(1).max(720).default(24),
	// Версия расширения, с которой оно принимает новый токен в ответе хода.
	ONEC_EXT_ROTATION_MIN: z.string().default("1.5.0"),
	// Версия расширения, ниже которой канал отвечает EXT_TOO_OLD. Пусто — не проверяем.
	ONEC_EXT_MIN_VERSION: z.string().default(""),
	// Сколько помнить ключ хода (Idempotency-Key): повтор в пределах срока получает тот же ответ.
	ONEC_TURN_KEY_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
	// Адрес панели BuhProf для ссылок на задачи, которые уходят в 1С («https://aleppo.kz»).
	// Пусто — ссылок нет вовсе: лучше не давать ссылку, чем давать неоткрывающуюся.
	PUBLIC_PANEL_URL: z.string().default(""),
	// Изменяющие вызовы задач и заметок на пару «база + пользователь» в минуту. 0 — без лимита.
	RATE_LIMIT_TASKS_WRITE_PER_MIN: z.coerce.number().int().min(0).max(600).default(20),
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
		rateLimits: `chat ${cfg.RATE_LIMIT_CHAT_PER_MIN}/min, attachments ${cfg.RATE_LIMIT_ATTACHMENTS_PER_MIN}/min, кластер 1С ${cfg.RATE_LIMIT_ONEC_CLUSTER_PER_MIN}/min на кластер`,
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
