import jwt from "jsonwebtoken";
import { prisma } from "../prisma/prisma-client.js";
import { ROUTE_TO_MODEL } from "./routeModels.js";
import { subjectOf } from "./routeSubjects.js";
import { listIncludesShared } from "../services/recordScope.js";
import { getInstallation } from "../services/installation.js";
import { operatorAccessMode, operatorSeesData, getSupportMode } from "../services/supportMode.js";
import { servicedOrgsFor } from "../services/serviceLinks.js";

// JWT_SECRET загружается из .env через dotenv (в server.js)
// Если переменная не задана — сервер не запустится (проверка в server.js)
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

/**
 * Генерирует JWT-токен для пользователя
 */
export function generateToken(user) {
	return jwt.sign(
		{
			uuid: user.uuid,
			username: user.username,
		},
		JWT_SECRET,
		{ expiresIn: JWT_EXPIRES_IN },
	);
}

/**
 * Middleware аутентификации.
 * Проверяет заголовок Authorization: Bearer <token>
 * Если токен валидный — добавляет req.user и пропускает дальше.
 */
export function authMiddleware(req, res, next) {
	// Пропускаем OPTIONS (CORS preflight)
	if (req.method === "OPTIONS") return next();

	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({
			success: false,
			message: "Требуется авторизация",
		});
	}

	const token = authHeader.slice(7);
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.user = decoded;
		next();
	} catch (err) {
		return res.status(401).json({
			success: false,
			message: "Недействительный или истёкший токен",
		});
	}
}

/**
 * Middleware мультитенантности.
 * Загружает organizationUuid, isSuperAdmin и роль в активной орг из БД.
 * Должен вызываться ПОСЛЕ authMiddleware.
 *
 * Устанавливает req.user:
 *   - organizationUuid  — активная организация (из User.organizationUuid)
 *   - isSuperAdmin      — глобальный суперадмин (видит всё)
 *   - isOrgAdmin        — администратор активной организации
 */
export async function tenantMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();
	if (!req.user?.uuid) return next();

	try {
		const dbUser = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: {
				uuid: true,
				organizationUuid: true,
				isSuperAdmin: true,
				accessRights: {
					select: { organizationUuid: true, role: true },
				},
			},
		});

		if (dbUser) {
			req.user.isSuperAdmin = dbUser.isSuperAdmin || false;
			/*
			 * ОПЕРАТОР УСТАНОВКИ ≠ ДОСТУП К УЧЁТУ (О5).
			 *
			 * Обслуживать установку и читать чужую выручку — разные полномочия. При
			 * `OPERATOR_DATA_ACCESS=support-mode` данные открыты оператору только на время
			 * включённого режима поддержки; администрирование (агенты, модули, бэкапы) работает
			 * всегда, потому что оно опирается на `isSuperAdmin`, а не на этот признак.
			 */
			if (req.user.isSuperAdmin && operatorAccessMode() === "support-mode") {
				req.user.operatorDataAccess = operatorSeesData({ support: await getSupportMode() });
			} else {
				req.user.operatorDataAccess = true;
			}
			req.user.organizationUuid = dbUser.organizationUuid || null;

			// Список UUID организаций, доступных пользователю
			const ownOrgs = dbUser.accessRights.map((uo) => uo.organizationUuid);

			/*
			 * ОРГАНИЗАЦИИ ПО ОБСЛУЖИВАНИЮ (К2 плана PLAN_INSTALL_MODES_2026-09-24.md).
			 *
			 * Сотрудник обслуживающей фирмы работает в учёте клиента не по членству, а по
			 * НАЗНАЧЕНИЮ: связь фирма→клиент плюс «этот бухгалтер ведёт этого клиента».
			 * Поэтому доступные организации — свои плюс назначенные, а не копии членств:
			 * при 200 клиентах копии сделали бы отзыв доступа уволенному перебором двухсот
			 * организаций, где один пропуск — утечка чужого учёта.
			 *
			 * Связь учитывается только ЖИВАЯ: подтверждённая клиентом и с неистёкшим сроком.
			 *
			 * Цена — один запрос на запрос пользователя. Если станет заметно, кэшировать
			 * назначения по пользователю (меняются они редко), но не раньше: преждевременный
			 * кэш прав опаснее лишнего запроса.
			 */
			const serviced = await servicedOrgsFor(dbUser.uuid ?? req.user.uuid);
			req.user.serviceContext = new Map(serviced.map((s) => [s.organizationUuid, s]));
			req.user.servicedOrgUuids = serviced.map((s) => s.organizationUuid);
			req.user.allowedOrgUuids = [...new Set([...ownOrgs, ...req.user.servicedOrgUuids])];

			/*
			 * Роль в активной организации — ТОЛЬКО по членству. Обслуживание учёт ведёт, но
			 * доступом клиента не распоряжается: иначе бухгалтер фирмы смог бы раздавать
			 * права в чужой организации (К2, профиль `service_accountant`).
			 */
			const activeOrgEntry = dbUser.accessRights.find(
				(uo) => uo.organizationUuid === dbUser.organizationUuid,
			);
			req.user.isOrgAdmin = activeOrgEntry?.role === "admin" || false;

			// Является ли администратором хотя бы одной организации
			req.user.isAnyOrgAdmin = dbUser.accessRights.some(
				(uo) => uo.role === "admin",
			);

			// Безопасность: если активная орг не входит в список разрешённых — сбрасываем
			if (
				dbUser.organizationUuid &&
				!req.user.isSuperAdmin &&
				!req.user.allowedOrgUuids.includes(dbUser.organizationUuid)
			) {
				req.user.organizationUuid = null;
				req.user.isOrgAdmin = false;
			}
		}
	} catch (err) {
		console.error("tenantMiddleware error:", err);
	}
	next();
}

/**
 * Формирует WHERE-фильтр для изоляции данных по организации.
 * - Суперадмин: без фильтра (видит всё)
 * - Обычный пользователь: фильтр по organizationUuid активной орг
 * @param {object} req - Express request с req.user
 * @param {string} field - название поля organizationUuid в модели
 * @returns {object} prisma where-clause
 */
export function tenantFilter(req, field = "organizationUuid") {
	if (!req.user) return {};
	// Суперадмин видит все данные — если ему это сейчас открыто (О5: режим поддержки).
	if (req.user.isSuperAdmin && req.user.operatorDataAccess !== false) return {};

	/*
	 * СВОДНЫЙ ВИД ПО ГРУППЕ — ОСОЗНАННЫЙ ВЫБОР, А НЕ ПОБОЧНЫЙ ЭФФЕКТ (Г2).
	 *
	 * Раньше «все мои организации» показывались ТОЛЬКО когда активной организации нет вовсе:
	 * то есть сводка получалась из отсутствия выбора, и человек не понимал, почему иногда
	 * видит три организации, а иногда одну. Теперь её просят явно — `?scope=group`, — и она
	 * ограничена теми организациями, к которым есть доступ.
	 *
	 * Создавать документы в сводном режиме нельзя (проверяется при записи): документ
	 * принадлежит конкретному юрлицу, и «создать в группе» — это дорогая ошибка учёта.
	 */
	if (groupScopeRequested(req) && req.user.allowedOrgUuids?.length) {
		return { [field]: { in: req.user.allowedOrgUuids } };
	}

	if (!req.user.organizationUuid) {
		// нет активной орг — показываем данные всех разрешённых организаций
		if (req.user.allowedOrgUuids?.length) {
			return { [field]: { in: req.user.allowedOrgUuids } };
		}
		return { [field]: null }; // нет ни активной, ни разрешённых — ничего не видит
	}
	return { [field]: req.user.organizationUuid };
}

/**
 * Готовый фильтр списка справочника: сам берёт режим установки.
 *
 * Роутерам не нужно знать про режимы — им нужно «покажи то, что положено этому предмету».
 * Режим кэшируется на 30 секунд, так что лишнего обращения к базе тут нет.
 */
export async function directoryScope(req, model, field = "organizationUuid") {
	const { mode } = await getInstallation();
	return directoryFilter(req, model, mode, field);
}

/**
 * ЧТО АРЕНДАТОР ВИДИТ ОБ УСТАНОВКЕ (И4 плана PLAN_INSTALL_MODES_2026-09-24.md).
 *
 * На общем сервере (`isolated`) организации друг другу посторонние, а разделы УСТАНОВКИ —
 * агенты 1С, реестр лицензий, состав модулей, бэкапы, журналы — рассказывают о ней целиком:
 * сколько там организаций, какие у них агенты, что установлено. Арендатору этого знать
 * незачем, даже если ему по недосмотру выдали право администрирования 1С.
 *
 * Правило узкое и опирается на уже существующий реестр предметов: закрываем ровно то, что там
 * помечено как `operator`. В остальных режимах (`group`, `service`, режим не выбран) поведение
 * не меняется — там администратор организации и есть тот, кто установку обслуживает.
 */
export async function installationScopeGuard(req, res, next) {
	try {
		if (req.user?.isSuperAdmin) return next();
		const { modeEffective } = await getInstallation();
		if (modeEffective !== "isolated") return next();

		const segment = req.path.replace(/^\/+/, "").split("/")[0];
		if (subjectOf(segment)?.kind !== "operator") return next();

		return res.status(403).json({
			success: false,
			code: "INSTALLATION_SCOPE",
			message: "Раздел относится к управлению сервером и доступен только его оператору",
		});
	} catch {
		// Настройки недоступны — не запираем работу: изоляцию данных обеспечивает tenantFilter.
		return next();
	}
}

/**
 * СВОДНЫЙ ВИД — ТОЛЬКО ДЛЯ ЧТЕНИЯ (Г2).
 *
 * В сводном режиме показаны организации ГРУППЫ сразу, и «создать здесь» не имеет ответа: в
 * какой именно организации? Молча подставить активную — значит завести документ не в том
 * юрлице, а это одна из самых дорогих ошибок учёта: находят её при сверке, через месяц.
 *
 * Поэтому запись в сводном режиме отклоняется сразу и с объяснением.
 */
export function groupScopeReadOnly(req, res, next) {
	if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return next();
	if (!groupScopeRequested(req)) return next();
	return res.status(400).json({
		success: false,
		code: "SCOPE_READ_ONLY",
		message: "В сводном виде по группе организаций запись невозможна — выберите организацию",
	});
}

/** Просил ли клиент сводный вид по группе: `?scope=group` или заголовок `X-Org-Scope: group`. */
export function groupScopeRequested(req) {
	const q = typeof req.query?.scope === "string" ? req.query.scope : null;
	const h = req.headers?.["x-org-scope"];
	return q === "group" || h === "group";
}

/**
 * Фильтр списка СПРАВОЧНИКА с учётом общих записей (Г3).
 *
 * Общая запись (`organizationUuid = null`) видна всем организациям установки — но только там,
 * где режим и предмет это допускают (`services/recordScope.js`). Правило одно на все витрины:
 * раньше список общие записи не показывал, а лукап в документе показывал, и один и тот же
 * контрагент существовал или нет в зависимости от того, откуда на него смотрят.
 *
 * @param {string} model — предмет (Counterparty, Product, …)
 * @param {string|null} mode — режим установки; null — не выбран
 */
export function directoryFilter(req, model, mode, field = "organizationUuid") {
	const base = tenantFilter(req, field);
	if (!listIncludesShared(model, mode)) return base;
	if (!Object.keys(base).length) return base; // суперадмин и так видит всё
	return { OR: [base, { [field]: null }] };
}

/**
 * Формирует WHERE-фрагмент для фильтрации справочника по организации,
 * ВЫБРАННОЙ В ФОРМЕ (req.query.organizationUuid), а не по активной орг.
 *
 * Используется зависимыми автокомплитами (склад, касса, ответственный и т.п.):
 * при выбранной в документе организации список ограничивается записями этой
 * организации + «глобальными» (organizationUuid = null), доступными всем.
 *
 * Если query-параметр не передан — возвращает {} (фильтрация не применяется,
 * изоляцию обеспечивает tenantFilter).
 *
 * @param {object} req   — Express request
 * @param {string} field — поле организации в модели (по умолчанию organizationUuid)
 * @returns {object} prisma where-fragment ({} | { OR: [...] })
 */
export function orgQueryFilter(req, field = "organizationUuid") {
	const raw = req.query?.[field];
	if (typeof raw !== "string" || !raw.trim()) return {};
	const val = raw.trim();
	if (val === "null") return { [field]: null };
	// записи выбранной орг + глобальные (общие для всех орг)
	return { OR: [{ [field]: val }, { [field]: null }] };
}

/**
 * Проверяет, имеет ли текущий пользователь доступ к конкретной записи.
 * Возвращает false → должен следовать ответ 404 (не 403, чтобы не раскрывать существование).
 *
 * @param {object|null} item   — запись из БД (может быть null)
 * @param {object}      req    — Express request с req.user
 * @param {string}      field  — поле организации в записи (по умолчанию "organizationUuid")
 */
export function checkOwnership(item, req, field = "organizationUuid") {
	if (!item) return false;
	if (!req.user) return false;
	if (req.user.isSuperAdmin) return true;

	const itemOrgUuid = item[field] ?? null;
	if (itemOrgUuid === null) return true; // глобальная запись — доступна всем

	const activeOrg = req.user.organizationUuid ?? null;
	const allowedOrgs = req.user.allowedOrgUuids ?? [];

	if (activeOrg && itemOrgUuid === activeOrg) return true;
	if (allowedOrgs.includes(itemOrgUuid)) return true;

	return false;
}

/**
 * Проверяет, что FK-поля в body документа ссылаются на записи из организаций,
 * доступных текущему пользователю. Принимает массив { model, uuid } — пар,
 * где model — camelCase Prisma-модель с полем organizationUuid.
 *
 * Возвращает null если всё ок, или строку с сообщением об ошибке.
 *
 * @param {object} req   — Express request
 * @param {object} tx    — Prisma client или transaction
 * @param {Array}  checks — [{ model: "warehouse", uuid: "..." }, ...]
 */
export async function checkFkOwnership(req, tx, checks) {
	if (!req.user || req.user.isSuperAdmin) return null;
	for (const { model, uuid } of checks) {
		if (!uuid) continue;
		try {
			const record = await tx[model].findUnique({
				where: { uuid },
				select: { organizationUuid: true },
			});
			if (!checkOwnership(record, req)) {
				return `Запись ${model} (${uuid}) не принадлежит вашей организации`;
			}
		} catch {
			// Модель не имеет organizationUuid — пропускаем
		}
	}
	return null;
}
// Карта «сегмент пути → модель прав» вынесена в `routeModels.js`: её читают профили прав
// (services/permissionProfiles.js), которым Prisma не нужна, а этот модуль её тянет.
export { ROUTE_TO_MODEL } from "./routeModels.js";


/**
 * Middleware проверки прав доступа.
 *
 * Определяет имя модели из URL, загружает `accessLevel` пользователя
 * и проверяет разрешение:
 *   - GET  → требуется "readonly" или "full"
 *   - POST / PUT / DELETE → требуется "full"
 *   - "none" или отсутствие записи → 403 Forbidden
 *
 * Суперадмин и dev-admin пропускаются без проверки.
 *
 * ДОЛЖЕН вызываться ПОСЛЕ authMiddleware + tenantMiddleware.
 */
/**
 * Есть ли у пользователя безусловный полный доступ (минуя таблицу прав):
 * суперадмин, админ организации, а в dev-режиме — пользователь admin.
 * Вынесено, чтобы точечные проверки в роутерах вели себя ТАК ЖЕ, как middleware.
 */
export function hasUnconditionalAccess(req) {
	if (req.user?.isSuperAdmin) return true;
	if (req.user?.isOrgAdmin || req.user?.isAnyOrgAdmin) return true;
	return devUnrestrictedAdmin(req.user?.username);
}

/**
 * ВСЕВЛАСТИЕ ПО ИМЕНИ — БОЛЬШЕ НЕ ПО УМОЛЧАНИЮ (П3 разбора 24.09).
 *
 * Раньше любой пользователь с именем `admin` получал полный доступ мимо прав, если
 * `NODE_ENV !== "production"`. А `ecosystem.config.js` без `APP_MODE=production` поднимает
 * ровно `development` — то есть на обычно запущенной установке существовал вечный суперадмин
 * по имени, даже когда флаг `isSuperAdmin` у него сняли.
 *
 * Теперь это включается ЯВНО и только в разработке: `DEV_UNRESTRICTED_ADMIN=1`. В production
 * переменная не действует вовсе — включить её там нельзя даже по ошибке.
 */
export function devUnrestrictedAdmin(username) {
	if (process.env.NODE_ENV === "production") return false;
	if (process.env.DEV_UNRESTRICTED_ADMIN !== "1") return false;
	return String(username ?? "").toLowerCase() === "admin";
}

/**
 * Проверка права на модель ДЛЯ ОТДЕЛЬНОГО МАРШРУТА.
 *
 * Нужна там, где модель нельзя вывести из URL и карты ROUTE_TO_MODEL: например
 * `/documents/:type/:uuid/clear-basis` работает над РАЗНЫМИ моделями в
 * зависимости от :type. Middleware такие маршруты пропускает (модель не найдена),
 * поэтому право проверяется вручную — этой функцией, чтобы правила совпадали.
 *
 * @returns {Promise<boolean>} true — доступ есть; false — отказать (403).
 */
export async function canAccessModel(req, modelName, { write = false } = {}) {
	if (!modelName) return false;
	if (hasUnconditionalAccess(req)) return true;

	const orgUuid = req.user?.organizationUuid || null;
	const allowedOrgUuids = req.user?.allowedOrgUuids || [];
	const orgsToCheck = orgUuid
		? [orgUuid, ...allowedOrgUuids.filter((u) => u !== orgUuid)]
		: allowedOrgUuids;

	const [orgRight, globalRight] = await Promise.all([
		orgsToCheck.length > 0
			? prisma.accessPermission.findFirst({
					where: { userUuid: req.user.uuid, modelName, organizationUuid: { in: orgsToCheck } },
					select: { accessLevel: true },
				})
			: null,
		prisma.accessPermission.findFirst({
			where: { userUuid: req.user.uuid, modelName, organizationUuid: null },
			select: { accessLevel: true },
		}),
	]);

	const level = orgRight?.accessLevel ?? globalRight?.accessLevel ?? "none";
	return write ? level === "full" : level === "readonly" || level === "full";
}

/**
 * Доступна ли пользователю КОНКРЕТНАЯ организация (переданная в теле/квери).
 * Нужна там, где организация приходит из запроса, а не выводится из записи, —
 * страховка от смены настроек ЧУЖОЙ организации. Суперадмин/админ орг — всегда.
 */
export function orgIsAccessible(req, organizationUuid) {
	if (hasUnconditionalAccess(req)) return true;
	if (!organizationUuid) return false;
	const allowed = [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids || [])];
	return allowed.includes(organizationUuid);
}

/**
 * ЗАПРЕТ ПО УМОЛЧАНИЮ — НО НЕ ОДНИМ ДНЁМ (О3).
 *
 * Маршрут, которого нет в карте моделей, сейчас проходит без проверки прав. Перевернуть это
 * умолчание разом нельзя: вместе с дырой погаснет работающее — восемнадцать сегментов живут
 * именно так, и часть из них проверяет доступ внутри себя (см. `utils/routeSubjects.js`).
 *
 * Поэтому рубильник `ACCESS_UNKNOWN_ROUTES`:
 *   observe (по умолчанию) — пропускаем, но пишем в журнал каждый НЕОПИСАННЫЙ сегмент. Описанные
 *                            в реестре предметов молчат: про них уже известно, почему они так;
 *   deny                   — 403. Включать ПОСЛЕ того, как журнал наблюдения замолчит, а профили
 *                            прав розданы (О2).
 *
 * ⚠ ПРОВЕРИТЬ ПОТОМ: перевести в `deny` на стенде, прогнать основные сценарии, затем в проде.
 */
function noteUnknownRoute(req, res, next, segment) {
	const subject = subjectOf(segment);
	// Описан и объяснён — пропускаем молча: право проверяется внутри роутера либо не нужно.
	if (subject) return next();

	if (process.env.ACCESS_UNKNOWN_ROUTES === "deny") {
		return res.status(403).json({
			success: false,
			code: "ROUTE_NOT_DESCRIBED",
			message: "Маршрут не описан в реестре прав доступа",
		});
	}
	// Один раз на сегмент за процесс: иначе журнал зальёт одной и той же строкой.
	if (!seenUnknownRoutes.has(segment)) {
		seenUnknownRoutes.add(segment);
		console.warn(`[access] маршрут /${segment} не описан ни в ROUTE_TO_MODEL, ни в ROUTE_SUBJECTS — пропущен без проверки прав`);
	}
	return next();
}
const seenUnknownRoutes = new Set();

export async function accessPermissionMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();

	// Безусловный доступ (суперадмин / админ орг / dev-admin) — те же правила,
	// что и у точечных проверок в роутерах (canAccessModel).
	if (hasUnconditionalAccess(req)) return next();

	// Определяем имя модели из URL
	const pathSegments = req.path.replace(/^\/+/, "").split("/");
	const routeSegment = pathSegments[0];

	const modelName = ROUTE_TO_MODEL[routeSegment];
	if (!modelName) return noteUnknownRoute(req, res, next, routeSegment);

	try {
		// Ищем права с учётом активной организации пользователя.
		// Приоритет: org-specific право для активной орг > право для любой allowedOrg > глобальное (organizationUuid = null)
		const orgUuid = req.user?.organizationUuid || null;
		const allowedOrgUuids = req.user?.allowedOrgUuids || [];

		// Все организации для поиска прав: активная + все разрешённые
		const orgsToCheck = orgUuid
			? [orgUuid, ...allowedOrgUuids.filter((u) => u !== orgUuid)]
			: allowedOrgUuids;

		const [anyOrgRight, globalRight] = await Promise.all([
			orgsToCheck.length > 0
				? prisma.accessPermission.findFirst({
						where: {
							userUuid: req.user.uuid,
							modelName,
							organizationUuid: { in: orgsToCheck },
						},
						// Приоритет: активная org выше, чем любая другая
						orderBy: orgUuid
							? [{ organizationUuid: "asc" }] // активная будет найдена через in
							: undefined,
						select: { accessLevel: true, organizationUuid: true },
					})
				: null,
			prisma.accessPermission.findFirst({
				where: { userUuid: req.user.uuid, modelName, organizationUuid: null },
				select: { accessLevel: true },
			}),
		]);

		// Если несколько org-прав — ищем активную отдельно для точного приоритета
		let orgRight = anyOrgRight;
		if (orgUuid && anyOrgRight && anyOrgRight.organizationUuid !== orgUuid) {
			// Есть право для другой орг, но не для активной — оставляем как fallback
			// Дополнительно ищем именно для активной
			const activeOrgRight = await prisma.accessPermission.findFirst({
				where: {
					userUuid: req.user.uuid,
					modelName,
					organizationUuid: orgUuid,
				},
				select: { accessLevel: true },
			});
			orgRight = activeOrgRight ?? anyOrgRight;
		}

		const level = orgRight?.accessLevel ?? globalRight?.accessLevel ?? "none";

		if (req.method === "GET") {
			if (level === "readonly" || level === "full") return next();
		} else {
			if (level === "full") return next();
		}

		// Логируем попытку несанкционированного доступа
		const orgCtx = orgUuid || allowedOrgUuids.join(",") || "no-org";
		console.warn(
			`[AccessDenied] user=${req.user?.username} org=${orgCtx} model=${modelName} method=${req.method} level=${level} ip=${req.ip}`,
		);

		return res.status(403).json({
			success: false,
			message: `Нет доступа к ${modelName}`,
		});
	} catch (err) {
		console.error("accessPermissionMiddleware error:", err);
		return next();
	}
}
