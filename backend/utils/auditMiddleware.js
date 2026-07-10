// ─────────────────────────────────────────────────────────────────────────────
// auditMiddleware (E1.2) — автоматический журнал действий на мутирующих запросах.
//
// Ставится ПОСЛЕ authMiddleware/tenantMiddleware/userAccessRightMiddleware:
// нужен req.user, и записывать в журнал имеет смысл только разрешённые действия.
//
// Что журналируется (по маршруту, через ROUTE_TO_MODEL):
//   POST   /<route>                 → create
//   PUT    /<route>/:id             → update (с diff «до/после»)
//   DELETE /<route>/:id             → delete
//   POST   /<route>/batch-delete    → batch_delete (по записи на каждый uuid)
//
// НЕ журналируется: GET, под-действия вида POST /<route>/:id/fill-accounting и
// POST /<route>/batch (пакетное сохранение строк) — это не CRUD над сущностью.
//
// Запись выполняется ПОСЛЕ успешного ответа (res.json с success), асинхронно и
// без await: аудит не задерживает и не роняет основной запрос.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { ROUTE_TO_MODEL } from "./auth.js";
import { recordAudit, computeDiff, objectNameOf } from "../services/auditLog.js";

/** Имя модели в prisma-клиенте: "Purchase" → "purchase". */
const clientKey = (modelName) => modelName.charAt(0).toLowerCase() + modelName.slice(1);

/** where по id (число) либо uuid (строка). */
const whereFor = (param) => {
	const n = Number(param);
	return !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: param };
};

export async function auditMiddleware(req, res, next) {
	if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
	if (!req.user?.username) return next();

	const segments = req.path.replace(/^\/+/, "").split("/");
	const objectType = ROUTE_TO_MODEL[segments[0]];
	if (!objectType) return next();

	const model = prisma[clientKey(objectType)];
	if (!model?.findUnique) return next();

	const sub = segments[1];
	const isBatchDelete = req.method === "POST" && sub === "batch-delete";

	let actionType;
	if (req.method === "DELETE" && sub) actionType = "delete";
	else if ((req.method === "PUT" || req.method === "PATCH") && sub) actionType = "update";
	else if (isBatchDelete) actionType = "batch_delete";
	else if (req.method === "POST" && !sub) actionType = "create";
	else return next(); // под-действия и пакетное сохранение строк — не CRUD

	// Снимок «до» — до того, как роутер изменит/удалит запись.
	let before = null;
	let beforeMany = null;
	try {
		if (actionType === "update" || actionType === "delete") {
			before = await model.findUnique({ where: whereFor(sub) });
		} else if (actionType === "batch_delete" && Array.isArray(req.body?.uuids)) {
			beforeMany = await model.findMany({ where: { uuid: { in: req.body.uuids } } });
		}
	} catch {
		// Не нашли/не смогли — журналируем то, что есть.
	}

	const ctx = {
		host: req.hostname ?? null,
		ip: req.ip ?? null,
		user: req.user,
	};

	const originalJson = res.json.bind(res);
	res.json = (body) => {
		// Пишем журнал только для успешного ответа.
		const ok = res.statusCode < 400 && body?.success !== false;
		if (ok) {
			// Не блокируем ответ: recordAudit сам глушит свои ошибки.
			void writeAudit({ actionType, objectType, before, beforeMany, body, ctx });
		}
		return originalJson(body);
	};

	return next();
}

async function writeAudit({ actionType, objectType, before, beforeMany, body, ctx }) {
	const after = body?.item ?? null;

	if (actionType === "batch_delete") {
		for (const rec of beforeMany ?? []) {
			await recordAudit({
				actionType,
				objectType,
				objectId: rec.uuid,
				objectName: objectNameOf(rec, objectType),
				organizationUuid: rec.organizationUuid ?? null,
				diff: computeDiff(rec, {}),
				...ctx,
			});
		}
		return;
	}

	if (actionType === "create") {
		if (!after?.uuid) return;
		await recordAudit({
			actionType,
			objectType,
			objectId: after.uuid,
			objectName: objectNameOf(after, objectType),
			organizationUuid: after.organizationUuid ?? ctx.user.organizationUuid ?? null,
			diff: computeDiff({}, after),
			...ctx,
		});
		return;
	}

	if (actionType === "update") {
		const rec = after ?? before;
		if (!rec?.uuid) return;
		const diff = computeDiff(before ?? {}, after ?? {});
		// Ничего содержательного не изменилось — не засоряем журнал.
		if (Object.keys(diff).length === 0) return;
		await recordAudit({
			actionType,
			objectType,
			objectId: rec.uuid,
			objectName: objectNameOf(rec, objectType),
			organizationUuid: rec.organizationUuid ?? null,
			diff,
			...ctx,
		});
		return;
	}

	if (actionType === "delete") {
		if (!before?.uuid) return;
		await recordAudit({
			actionType,
			objectType,
			objectId: before.uuid,
			objectName: objectNameOf(before, objectType),
			organizationUuid: before.organizationUuid ?? null,
			diff: computeDiff(before, {}),
			...ctx,
		});
	}
}

export default auditMiddleware;
