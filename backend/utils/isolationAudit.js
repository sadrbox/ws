// АУДИТ ИЗОЛЯЦИИ АРЕНДАТОРОВ (И2 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. В режиме `isolated` один сервер обслуживает организации, которые друг другу
// посторонние, и утечка между ними — не дефект, а инцидент. Проверять это ручным осмотром
// невозможно: роутеров 110, и каждый новый по умолчанию читает базу как хочет.
//
// ЧТО ДЕЛАЕТ. Находит роутеры, которые читают данные организации, и проверяет, что каждый
// применяет хоть один известный механизм изоляции — `tenantFilter`, `directoryScope`,
// `orgQueryFilter`, `checkOwnership`, `orgIsAccessible` — либо построен на фабрике документов
// (изоляция внутри неё), либо внесён в список исключений С ОБЪЯСНЕНИЕМ.
//
// ЧЕГО НЕ ДЕЛАЕТ. Это статическая проверка: она видит присутствие механизма, а не правильность
// его применения. Роутер, вызвавший `tenantFilter` и забывший подставить результат в `where`,
// она пропустит. Поэтому она не заменяет живой прогон (`prisma/test-multitenancy.js`), а
// закрывает другую брешь — «забыли вовсе», самую частую и самую тихую.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Механизмы изоляции, которые считаются достаточным признаком. */
export const GUARDS = ["tenantFilter", "directoryScope", "orgQueryFilter", "checkOwnership", "orgIsAccessible", "isAdminOfOrg"];

/**
 * Фабрики: изоляция живёт внутри них, а не в роутере-потомке. Признак — ВЫЗОВ фабрики, а не
 * упоминание файла: раньше роутер, импортировавший из фабрики одну вспомогательную функцию
 * (`syncItemsFromParent`), целиком считался изолированным и не проверялся (Б12 аудита 26.09).
 */
export const FACTORIES = ["createDocumentHeaderRouter(", "createDocumentItemsRouter(", "createCashOrderRouter("];

/**
 * Роутеры, которым изоляция по организации не нужна или обеспечивается иначе.
 * Каждый — с объяснением: запись без причины через месяц не отличить от забытой.
 */
export const EXEMPT = {
	"auth.js": "вход, регистрация и приглашение — пользователь ещё не определён; организация появляется как раз здесь",
	"accessrights.js": "членства и роли: тот же предмет, что и users.js, та же проверка администратора",
	"chat.js": "внутренний чат: своя проверка организации (canAccessOrg) — по разрешённым организациям пользователя",
	// users.js и sync.js после Б1/Б3 аудита 26.09 применяют tenantFilter сами — исключение снято.
	"refreplacement.js": "поиск и замена ссылок по всей базе — только суперадмину (router.use в начале роутера), модель приходит из запроса",
	"chatStream.js": "поток SSE того же чата: токен в строке запроса, организация проверяется при подписке",
	"bpai.js": "служебный канал AI-сервиса (/bpai): свой ключ X-Api-Key, организация определяется по БИН из 1С",
	"egov.js": "обращение к открытым данным eGov по БИН: пишет контакты владельца, которого уже проверил вызывающий",
	"waWebhook.js": "вебхук провайдера WhatsApp: приходит извне без пользователя, канал опознаётся по подписи",
	"openapi.js": "описание маршрутов без данных",
};

/**
 * Известные дыры В ЧУЖИХ ЗОНАХ, найденные прозревшим аудитом (Б12 аудита 26.09): записаны явно,
 * чтобы сборка не падала у всех разом, но и не забылись. Тест требует, чтобы каждая запись ЕЩЁ
 * была дырой — починили роутер, убрали строку (как ратчет линтера).
 */
export const KNOWN_GAPS = {};

const READ_RE = /prisma\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)/g;
// Обращение через константу: `prisma[MODEL].findMany` — так написана половина роутеров.
const READ_DYN_RE = /prisma\[(\w+)\]\.(findMany|findFirst|findUnique|count|aggregate|groupBy)/g;

/** Модели с полем organizationUuid — по схеме Prisma (camelCase, как у клиента). */
export function orgScopedModels(schemaText) {
	const out = new Map();
	for (const m of schemaText.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
		const [, name, body] = m;
		if (/^\s*organizationUuid\s/m.test(body)) out.set(name[0].toLowerCase() + name.slice(1), name);
	}
	return out;
}

/**
 * Найти роутеры, читающие данные организации без единого механизма изоляции.
 * @returns {{file: string, models: string[]}[]}
 */
export function auditIsolation({ routerDir, schemaPath, knownGaps = KNOWN_GAPS }) {
	const models = orgScopedModels(readFileSync(schemaPath, "utf8"));
	const problems = [];
	for (const file of readdirSync(routerDir).filter((f) => f.endsWith(".js")).sort()) {
		if (file in EXEMPT || file in knownGaps) continue;
		const hits = readsWithoutGuard(readFileSync(path.join(routerDir, file), "utf8"), models);
		if (hits.length) problems.push({ file, models: hits });
	}
	return problems;
}

/**
 * Модели организации, которые текст роутера читает без единого механизма изоляции.
 * Константы вида `const MODEL = "sale"` подставляются в `prisma[MODEL]`; нераспознанное имя
 * (`prisma[modelName]` из запроса) считается чтением неизвестной модели — «?имя».
 */
export function readsWithoutGuard(txt, models) {
	if (GUARDS.some((g) => txt.includes(g))) return [];
	if (FACTORIES.some((f) => txt.includes(f))) return [];
	const consts = {};
	for (const m of txt.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']*)["']/g)) consts[m[1]] = m[2];
	const hits = new Set();
	for (const m of txt.matchAll(READ_RE)) {
		const model = models.get(m[1]);
		if (model) hits.add(model);
	}
	for (const m of txt.matchAll(READ_DYN_RE)) {
		const name = consts[m[1]];
		if (name === undefined) hits.add(`?${m[1]}`);
		else if (models.get(name)) hits.add(models.get(name));
	}
	return [...hits].sort();
}

/** Известные дыры, которые уже закрыты (их надо убрать из KNOWN_GAPS). */
export function staleKnownGaps({ routerDir, schemaPath, knownGaps = KNOWN_GAPS }) {
	const models = orgScopedModels(readFileSync(schemaPath, "utf8"));
	return Object.keys(knownGaps).filter((file) => {
		let txt;
		try { txt = readFileSync(path.join(routerDir, file), "utf8"); } catch { return true; }
		return readsWithoutGuard(txt, models).length === 0;
	});
}

export default { GUARDS, FACTORIES, EXEMPT, KNOWN_GAPS, orgScopedModels, auditIsolation, readsWithoutGuard, staleKnownGaps };
