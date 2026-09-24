// ПРЕДМЕТ МАРШРУТА: чем именно распоряжается каждый путь (О3 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. `accessPermissionMiddleware` определяет модель по первому сегменту пути через
// `ROUTE_TO_MODEL`, а не найдя — ПРОПУСКАЕТ запрос: `if (!modelName) return next()`. Умолчание
// выбрано наоборот: каждый новый роутер по умолчанию открыт, и замечают это только на аудите.
// Из 40 сегментов в карте прав 18 — остальные восемнадцать не проверяются ничем, кроме изоляции
// арендатора (П1 разбора `docs/DESIGN_PREINSTALL_AUDIT_2026-09-24.md`).
//
// ЧТО ЗДЕСЬ. Реестр сегментов, у которых предмета-модели НЕТ, с объяснением почему. Вместе с
// `ROUTE_TO_MODEL` он покрывает все маршруты, и это проверяется тестом: сегмент, не попавший ни
// туда, ни сюда, — забытый, а не безопасный.
//
// ПОЧЕМУ НЕ ПРОСТО ДОПИСАТЬ ИХ В КАРТУ МОДЕЛЕЙ. Потому что это мгновенно закрыло бы доступ всем,
// у кого нет соответствующего права, — а права по этим моделям никто никогда не выдавал. Сначала
// роздать профили (О2), потом переносить сегменты отсюда в карту — по одному, с проверкой.
//
// БЕЗ PRISMA: модуль читается тестом в гейте и не тянет за собой базу.

/**
 * Виды предметов.
 *
 *   public   — до авторизации или без данных организации (вход, документация, здоровье,
 *              публичные эндпоинты лицензирования);
 *   operator — распоряжается УСТАНОВКОЙ, а не учётом: проверка внутри роутера (суперадмин);
 *   guarded  — предмет зависит от параметров запроса, поэтому право проверяется внутри
 *              роутера вручную (`canAccessModel`) — middleware такое вывести не может;
 *   shared   — общий справочник: читается всеми, кто вошёл; правка — отдельным правом внутри;
 *   report   — отчёт: право проверяется по ПРЕДМЕТУ отчёта (см. `REPORT_SUBJECTS`);
 *   todo     — предмет есть, но право по нему ещё никому не выдавалось; перенос в
 *              `ROUTE_TO_MODEL` запланирован и сломает доступ, если сделать его вслепую.
 */
export const SUBJECT_KINDS = ["public", "operator", "guarded", "shared", "report", "todo"];

export const ROUTE_SUBJECTS = {
	// ── Публичные ────────────────────────────────────────────────────────────
	auth: { kind: "public", note: "вход, регистрация, приглашение, сведения об установке" },
	api: { kind: "public", note: "openapi.json и Swagger UI — перечень маршрутов без данных" },
	health: { kind: "public", note: "проверка живости" },
	token: { kind: "public", note: "лицензии ЭСФ: выдача токена (свой rate limit по IP и БИН)" },
	heartbeat: { kind: "public", note: "лицензии ЭСФ: отметка установки" },
	verify: { kind: "public", note: "лицензии ЭСФ: проверка по БИН" },
	"activation-request": { kind: "public", note: "лицензии ЭСФ: заявка на активацию" },

	// ── Распоряжаются установкой ─────────────────────────────────────────────
	admin: { kind: "operator", note: "бэкапы (backup.js): проверка суперадмина внутри" },
	"esf-licenses": { kind: "operator", note: "реестр лицензий — только у БухПроф (К6 плана)" },
	"module-settings": { kind: "operator", note: "состав модулей организации: PUT — суперадмин" },
	"permission-profiles": { kind: "operator", note: "назначение профилей: проверка внутри (О2)" },
	"service-links": { kind: "guarded", note: "обслуживание клиентов (К1–К5): права проверяются по стороне связи — фирма или клиент" },

	// ── Право проверяется внутри роутера ─────────────────────────────────────
	documents: { kind: "guarded", note: "цепочка «на основании»: модель зависит от :type, внутри canAccessModel" },
	sync: { kind: "guarded", note: "обмен офлайн-данными: предмет в теле запроса" },
	prune: { kind: "guarded", note: "чистка истории действий: предмет — ActivityHistory, проверка внутри" },
	data: { kind: "guarded", note: "обобщённые выборки api/v1.js" },

	// ── Общие справочники ────────────────────────────────────────────────────
	classifiers: { kind: "shared", note: "ГСВС/ТНВЭД: общие для всех организаций, нужны при вводе документов" },

	// ── Отчёты ───────────────────────────────────────────────────────────────
	reports: { kind: "report", note: "право по предмету отчёта — REPORT_SUBJECTS ниже" },

	// ── Предмет есть, право ещё не раздавалось ───────────────────────────────
	// Переносить в ROUTE_TO_MODEL по одному и ПОСЛЕ раздачи профилей: иначе у всех разом
	// пропадут заметки, метки и задачи, и это будет выглядеть поломкой, а не ужесточением.
	notes: { kind: "todo", model: "Note", note: "заметки к записям" },
	"object-marks": { kind: "todo", model: "ObjectMark", note: "метки объектов" },
	tasks: { kind: "todo", model: "Todo", note: "служебный канал BuhProf AI (/bpai): свой ключ X-Api-Key" },
	"task-statuses": { kind: "todo", model: "TodoStatus", note: "статусы задач, тот же служебный канал /bpai" },
	"document-number": { kind: "todo", model: "DocumentNumberSetting", note: "выдача номера документа" },
	"document-number-settings": { kind: "todo", model: "DocumentNumberSetting", note: "настройки нумерации" },
	chat: { kind: "todo", model: "ChatMessage", note: "внутренний чат и SSE-поток" },
	wa: { kind: "todo", model: "WaConversation", note: "WhatsApp: переписка и вебхук" },
	awp: { kind: "todo", model: "Sale", note: "ЭАВР: гос-документы по реализациям" },
	snt: { kind: "todo", model: "Sale", note: "СНТ: гос-документы по реализациям" },
	egov: { kind: "todo", model: "Counterparty", note: "автозаполнение ЮЛ по БИН из открытых данных" },
};

/**
 * Предмет каждого отчёта (П2 разбора).
 *
 * Отчёты фильтруют по организации и больше ничего не спрашивают, а в меню закрыты правами —
 * то есть запрет существует ТОЛЬКО в интерфейсе. Прямой запрос отдаёт выручку тому, кому продажи
 * не открывали. Ключ — часть пути после `/reports/`.
 */
export const REPORT_SUBJECTS = {
	"sales-by-product": "Sale",
	"sales-by-product-xyz": "Sale",
	"sales-by-manager": "Sale",
	"material-statement": "Product",
	"inventory-batches": "ProductBatch",
	"product-movements": "Product",
	// Сводка по пользователям: предмет — сами пользователи, а не продажи.
	"user-performance": "User",
};

export function subjectOf(segment) {
	return ROUTE_SUBJECTS[segment] ?? null;
}

/** Модель-предмет отчёта; null — отчёт неизвестен (новый и не описан). */
export function reportSubject(name) {
	return REPORT_SUBJECTS[name] ?? null;
}

export default { SUBJECT_KINDS, ROUTE_SUBJECTS, REPORT_SUBJECTS, subjectOf, reportSubject };
