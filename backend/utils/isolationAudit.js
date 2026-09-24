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
export const GUARDS = ["tenantFilter", "directoryScope", "orgQueryFilter", "checkOwnership", "orgIsAccessible"];

/** Фабрики: изоляция живёт внутри них, а не в роутере-потомке. */
export const FACTORIES = ["_documentHeaderFactory", "_documentItemsFactory", "_cashOrderFactory"];

/**
 * Роутеры, которым изоляция по организации не нужна или обеспечивается иначе.
 * Каждый — с объяснением: запись без причины через месяц не отличить от забытой.
 */
export const EXEMPT = {
	"auth.js": "вход, регистрация и приглашение — пользователь ещё не определён; организация появляется как раз здесь",
	"users.js": "управление пользователями: организация у User — это членство, доступ проверяет hasUnconditionalAccess внутри",
	"accessrights.js": "членства и роли: тот же предмет, что и users.js, та же проверка администратора",
	"chat.js": "внутренний чат: своя проверка организации (canAccessOrg) — по разрешённым организациям пользователя",
	"chatStream.js": "поток SSE того же чата: токен в строке запроса, организация проверяется при подписке",
	"bpai.js": "служебный канал AI-сервиса (/bpai): свой ключ X-Api-Key, организация определяется по БИН из 1С",
	"egov.js": "обращение к открытым данным eGov по БИН: пишет контакты владельца, которого уже проверил вызывающий",
	"waWebhook.js": "вебхук провайдера WhatsApp: приходит извне без пользователя, канал опознаётся по подписи",
	"openapi.js": "описание маршрутов без данных",
	"sync.js": "обмен офлайн-данными: предмет и организация приходят в теле, проверка внутри",
};

const READ_RE = /prisma\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)/g;

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
export function auditIsolation({ routerDir, schemaPath }) {
	const models = orgScopedModels(readFileSync(schemaPath, "utf8"));
	const problems = [];
	for (const file of readdirSync(routerDir).filter((f) => f.endsWith(".js")).sort()) {
		if (file in EXEMPT) continue;
		const txt = readFileSync(path.join(routerDir, file), "utf8");
		if (GUARDS.some((g) => txt.includes(g))) continue;
		if (FACTORIES.some((f) => txt.includes(f))) continue;

		const hits = new Set();
		for (const m of txt.matchAll(READ_RE)) {
			const model = models.get(m[1]);
			if (model) hits.add(model);
		}
		if (hits.size) problems.push({ file, models: [...hits].sort() });
	}
	return problems;
}

export default { GUARDS, FACTORIES, EXEMPT, orgScopedModels, auditIsolation };
