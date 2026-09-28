import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/prisma-client.js";
import { getQuotas } from "../../services/quotas.js";
import { checkOwnership, orgIsAccessible } from "../../utils/auth.js";
import { getInstallation } from "../../services/installation.js";
import { modeAllowsShared } from "../../services/recordScope.js";

const router = express.Router();

/*
 * ЧЕЙ ФАЙЛ — РЕШАЕТ ЕГО ВЛАДЕЛЕЦ (Б6 аудита 26.09).
 *
 * Файл привязан к записи-владельцу (`ownerType` + `ownerUuid`); поля организации у него долго не
 * было. Раньше это значило «ничей» — список всех файлов, скачивание, удаление и правка
 * по uuid работали через организации, а загрузить можно было к любой чужой записи. Теперь
 * доступ к файлу = доступ к его владельцу: запись владельца → её организация → `checkOwnership`.
 *
 * Владелец «global» (общий список «Файлы»): новые файлы кладутся с ownerUuid = организация
 * загрузившего, то есть это «общие файлы организации». Старые «global/global» — действительно
 * общие: читаются там, где режим установки допускает общие записи (не на общем сервере), а
 * менять и удалять их может только суперадмин.
 *
 * Неизвестный вид владельца — доступ только суперадмину: забытый вид не должен стать дырой.
 *
 * КОЛОНКА ОРГАНИЗАЦИИ (миграция 20260926200000_attached_files_organization) — для выборок: список
 * «Файлы» берёт файлы доступных организаций одним запросом и проверяет владельца только у строк без
 * организации (общие записи, старые файлы). Доступ к КОНКРЕТНОМУ файлу по-прежнему решает владелец.
 * Колонку используем, только если её знает клиент Prisma И она есть в базе: выкладка идёт в три шага
 * (prisma generate, migrate deploy, перезапуск), и файлы не должны ломаться, если их перепутать.
 *
 * Проверить потом: суммарная квота хранилища организации (services/quotas.js) — теперь это
 * SUM("fileSize") по колонке; сама квота и её настройка — отдельная задача.
 */
const FILE_ORG_KNOWN = (Prisma.dmmf?.datamodel?.models ?? [])
	.find((m) => m.name === "AttachedFile")?.fields.some((f) => f.name === "organizationUuid") ?? false;
let fileOrgInDb = null;

/** Готова ли колонка организации файла (клиент знает поле и миграция применена). */
export async function fileOrgColumnReady(db = prisma) {
	if (!FILE_ORG_KNOWN) return false;
	if (fileOrgInDb !== null) return fileOrgInDb;
	try {
		const rows = await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_name = 'attached_files' AND column_name = 'organizationUuid' LIMIT 1`;
		fileOrgInDb = rows.length > 0;
		return fileOrgInDb;
	} catch {
		return false; // не кэшируем: проверим при следующем запросе
	}
}

/** Параметры запроса к attachedFile: без колонки, пока миграция не применена. */
async function fileOpts() {
	return FILE_ORG_KNOWN && !(await fileOrgColumnReady()) ? { omit: { organizationUuid: true } } : {};
}
const OWNER_KINDS = {
	organization: { model: "organization", orgs: (r) => [r.uuid], select: { uuid: true } },
	counterparty: { model: "counterparty" },
	contract: { model: "contract" },
	contactperson: { model: "contactPerson" },
	employee: { model: "employee", allowShared: false },
	product: { model: "product" },
	todo: { model: "todo", allowShared: false },
	edo_document: {
		model: "edoDocument",
		orgs: (r) => [r.senderOrgUuid, r.receiverOrgUuid].filter(Boolean),
		select: { senderOrgUuid: true, receiverOrgUuid: true },
	},
};
const LEGACY_GLOBAL = "global";

function operatorSees(req) {
	return !!req.user?.isSuperAdmin && req.user?.operatorDataAccess !== false;
}

/**
 * Доступен ли владелец файла. mode: "read" | "write".
 * Кэш `memo` — для списка, где у многих файлов один владелец.
 */
export async function ownerAccessible(req, ownerType, ownerUuid, mode = "read", memo = null) {
	if (operatorSees(req)) return true;
	const type = String(ownerType ?? "");
	const uuid = String(ownerUuid ?? "");
	if (!type || !uuid) return false;
	const key = `${type}:${uuid}:${mode}`;
	if (memo?.has(key)) return memo.get(key);
	let ok = false;
	if (type === "global") {
		if (uuid === LEGACY_GLOBAL) {
			ok = mode === "read" && modeAllowsShared((await getInstallation())?.mode ?? null);
		} else {
			ok = orgIsAccessible(req, uuid);
		}
	} else if (OWNER_KINDS[type]) {
		const kind = OWNER_KINDS[type];
		const row = await prisma[kind.model].findUnique({
			where: { uuid },
			select: kind.select ?? { organizationUuid: true },
		}).catch(() => null);
		if (row) {
			ok = kind.orgs
				? kind.orgs(row).some((o) => orgIsAccessible(req, o))
				: checkOwnership(row, req, "organizationUuid", { allowShared: kind.allowShared ?? true });
		}
	}
	memo?.set(key, ok);
	return ok;
}

/** Организация записи-владельца — для колонки файла. null — общая запись или владелец неизвестен. */
export async function ownerOrganization(ownerType, ownerUuid) {
	const type = String(ownerType ?? "");
	const uuid = String(ownerUuid ?? "");
	if (type === "global") return uuid === LEGACY_GLOBAL ? null : uuid;
	const kind = OWNER_KINDS[type];
	if (!kind || !uuid) return null;
	const row = await prisma[kind.model].findUnique({ where: { uuid }, select: kind.select ?? { organizationUuid: true } }).catch(() => null);
	if (!row) return null;
	return kind.orgs ? kind.orgs(row)[0] ?? null : row.organizationUuid ?? null;
}

/**
 * Организация файла общего списка «Файлы» (владелец `global`) — P3 аудита 27.09.
 *
 * Раньше — только активная, а без неё (активная не выбрана) — 400 «Не выбрана организация», хотя
 * организация однозначна или названа. Теперь: названная в теле `organizationUuid` (только доступная —
 * иначе 403), иначе активная, иначе единственная доступная. Оператору установки без организации —
 * по-прежнему «всеобщий» файл (null). Неоднозначно — 400 с просьбой выбрать.
 * @returns {{ org: string|null } | { status: number, code?: string, message: string }}
 */
export function globalUploadOrg(req, requested) {
	const named = typeof requested === "string" && requested.trim() ? requested.trim() : null;
	if (named) {
		if (!orgIsAccessible(req, named)) return { status: 403, code: "ORG_NOT_ACCESSIBLE", message: "Организация недоступна" };
		return { org: named };
	}
	const active = req.user?.organizationUuid ?? null;
	if (active) return { org: active };
	if (operatorSees(req)) return { org: null };
	const allowed = [...new Set(req.user?.allowedOrgUuids ?? [])];
	if (allowed.length === 1) return { org: allowed[0] };
	return { status: 400, message: "Не выбрана организация файла — выберите организацию" };
}

/** Файл по uuid, если его владелец доступен; иначе null (ответ 404, существование не раскрываем). */
async function findAccessibleFile(req, uuid, mode = "read") {
	const file = await prisma.attachedFile.findUnique({ where: { uuid: String(uuid) }, ...(await fileOpts()) });
	if (!file || file.deletedAt) return null;
	return (await ownerAccessible(req, file.ownerType, file.ownerUuid, mode)) ? file : null;
}

/** Убрать загруженные multer файлы с диска (отказ после приёма). */
function dropUploaded(req) {
	for (const f of [req.file, ...(req.files?.file ?? []), ...(req.files?.thumbnail ?? [])]) {
		if (f?.path) fs.unlink(f.path, () => {});
	}
}

const UPLOAD_DIR = path.resolve("uploads/files");
if (!fs.existsSync(UPLOAD_DIR)) {
	fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
	filename: (_req, file, cb) => {
		const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const ext = path.extname(file.originalname);
		cb(null, `${unique}${ext}`);
	},
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================
// GET /files?ownerType=xxx&ownerUuid=xxx
// ============================================
router.get("/files", async (req, res) => {
	try {
		const { ownerType, ownerUuid } = req.query;
		if (!ownerType || !ownerUuid) {
			return res
				.status(400)
				.json({ success: false, message: "ownerType и ownerUuid обязательны" });
		}

		// Файлы чужого владельца — пустой список, а не 403: существование записи не раскрываем.
		if (!(await ownerAccessible(req, ownerType, ownerUuid, "read"))) {
			return res.status(200).json({ success: true, items: [], total: 0 });
		}
		const items = await prisma.attachedFile.findMany({
			where: {
				ownerType: String(ownerType),
				ownerUuid: String(ownerUuid),
				deletedAt: null,
			},
			orderBy: { uploadedAt: "desc" },
			...(await fileOpts()),
		});

		return res.status(200).json({
			success: true,
			items,
			total: items.length,
		});
	} catch (error) {
		console.error("GET /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /files/all — ВСЕ прикреплённые файлы (для общего списка «Файлы» в меню).
// Объявлен ДО "/files/download/:uuid", чтобы "all" не принялся за :uuid.
// ============================================
router.get("/files/all", async (req, res) => {
	try {
		// Только файлы доступных владельцев (раньше — файлы всех организаций установки). С колонкой
		// организации — одним запросом: файлы доступных организаций сразу, а строки без организации
		// (общие записи, старые файлы) — с проверкой владельца.
		const opts = await fileOpts();
		const orgs = operatorSees(req) ? null : [...new Set([req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean))];
		const byColumn = orgs !== null && (await fileOrgColumnReady());
		const all = await prisma.attachedFile.findMany({
			where: {
				deletedAt: null,
				...(byColumn ? { OR: [{ organizationUuid: { in: orgs } }, { organizationUuid: null }] } : {}),
			},
			orderBy: { uploadedAt: "desc" },
			...opts,
		});
		const memo = new Map();
		const items = [];
		for (const f of all) {
			if (byColumn && f.organizationUuid) {
				items.push(f);
				continue;
			}
			if (await ownerAccessible(req, f.ownerType, f.ownerUuid, "read", memo)) items.push(f);
		}
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error("GET /files/all error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /files — загрузка файла
// ============================================
// Миниатюру генерирует КЛИЕНТ (canvas) и присылает вторым файлом. Так сервер не тянет
// нативный ресайзер (sharp) — на Alpine это лишняя нативная зависимость, — а список
// товаров не качает полноразмерные фото: превью весит килобайты вместо мегабайт.
const uploadFields = upload.fields([
	{ name: "file", maxCount: 1 },
	{ name: "thumbnail", maxCount: 1 },
]);

router.post("/files", uploadFields, async (req, res) => {
	try {
		const { ownerType, ownerUuid, comment } = req.body;
		req.file = req.files?.file?.[0];
		const thumb = req.files?.thumbnail?.[0];
		if (!ownerType || !ownerUuid || !req.file) {
			dropUploaded(req);
			return res.status(400).json({
				success: false,
				message: "ownerType, ownerUuid и file обязательны",
			});
		}

		// Общий список «Файлы» кладёт файл в организацию загрузившего, а не во «всеобщие».
		let effOwnerUuid = String(ownerUuid);
		if (ownerType === "global") {
			const r = globalUploadOrg(req, req.body?.organizationUuid);
			if (r.status) {
				dropUploaded(req);
				return res.status(r.status).json({ success: false, ...(r.code ? { code: r.code } : {}), message: r.message });
			}
			effOwnerUuid = r.org ?? LEGACY_GLOBAL;
		}
		// Прикрепить можно только к доступной записи (раньше — к любой, в т.ч. чужой).
		if (!(await ownerAccessible(req, ownerType, effOwnerUuid, "write"))) {
			dropUploaded(req);
			return res.status(404).json({ success: false, message: "Владелец файла не найден" });
		}

		/*
		 * КВОТА НА РАЗМЕР ОДНОГО ФАЙЛА (И3 плана INSTALL_MODES).
		 *
		 * Общий предел multer (50 МБ) одинаков для всех; на общем сервере арендатору можно
		 * назначить свой, более строгий. Ноль или пусто — предел только общий, и тогда здесь
		 * ничего не меняется.
		 *
		 * СУММАРНОГО ХРАНИЛИЩА ОРГАНИЗАЦИИ ЗДЕСЬ НЕТ, и это не забывчивость: у `AttachedFile`
		 * нет поля организации — файл привязан к владельцу (`ownerType`+`ownerUuid`), и чтобы
		 * сложить объём по организации, пришлось бы обойти все виды владельцев. Пока предел
		 * один — на файл; суммарный появится вместе с полем организации у вложения.
		 */
		// Квота — организации файла общего списка, если она выбрана не активной (P3 аудита 27.09).
		const quotaOrg = (ownerType === "global" && effOwnerUuid !== LEGACY_GLOBAL ? effOwnerUuid : null) ?? req.user?.organizationUuid ?? null;
		if (quotaOrg) {
			const { fileMb } = await getQuotas(quotaOrg);
			if (fileMb && req.file.size > fileMb * 1024 * 1024) {
				dropUploaded(req);
				return res.status(413).json({
					success: false,
					code: "QUOTA_EXCEEDED",
					message: `Файл больше разрешённого размера (${fileMb} МБ)`,
				});
			}
		}

		// Корректная обработка кириллических имён файлов
		let fileName = req.file.originalname;
		try {
			// Проверяем, если имя файла уже в UTF-8 — оставляем как есть
			// Если пришло в latin1 (старые версии multer) — декодируем
			const decoded = Buffer.from(fileName, "latin1").toString("utf8");
			// Если decoded отличается и содержит корректные символы — используем его
			if (decoded !== fileName && !/\ufffd/.test(decoded)) {
				fileName = decoded;
			}
		} catch {
			// Если ошибка — оставляем оригинальное имя
		}

		// Миниатюра лежит рядом с оригиналом: <файл>.thumb. Отдельного поля в схеме не
		// заводим — путь выводится из filePath, а её отсутствие (старые файлы) не ошибка.
		if (thumb) {
			try {
				fs.renameSync(
					path.resolve(UPLOAD_DIR, thumb.filename),
					path.resolve(UPLOAD_DIR, `${req.file.filename}.thumb`),
				);
			} catch (e) {
				console.warn("[files] не удалось сохранить миниатюру:", e.message);
			}
		}

		const colReady = await fileOrgColumnReady();
		const item = await prisma.attachedFile.create({
			...(await fileOpts()),
			data: {
				...(colReady ? { organizationUuid: await ownerOrganization(ownerType, effOwnerUuid) } : {}),
				ownerType,
				ownerUuid: effOwnerUuid,
				fileName,
				filePath: req.file.filename,
				fileSize: req.file.size,
				mimeType: req.file.mimetype,
				comment: comment || null,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		dropUploaded(req);
		console.error("POST /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /files/thumb/:uuid — МИНИАТЮРА (превью в карточке товара)
//
// Отдаём уменьшенную копию, а не оригинал: список товаров с фото иначе тянет мегабайты
// на каждую карточку. Если миниатюры нет (файл загружен до этой правки) — отдаём
// оригинал: лучше медленно, чем пустой квадрат.
// ============================================
router.get("/files/thumb/:uuid", async (req, res) => {
	try {
		const file = await findAccessibleFile(req, req.params.uuid, "read");
		if (!file) return res.status(404).json({ success: false, message: "Файл не найден" });

		const original = path.resolve(UPLOAD_DIR, file.filePath);
		if (!original.startsWith(UPLOAD_DIR)) {
			return res.status(403).json({ success: false, message: "Доступ запрещён" });
		}
		const thumbPath = `${original}.thumb`;
		const target = fs.existsSync(thumbPath) ? thumbPath : original;
		if (!fs.existsSync(target)) {
			return res.status(404).json({ success: false, message: "Файл не найден на диске" });
		}

		// Картинка неизменяема (новая загрузка = новый uuid) — можно кэшировать надолго.
		res.setHeader("Cache-Control", "private, max-age=86400");
		res.setHeader("Content-Type", target === thumbPath ? "image/jpeg" : (file.mimeType || "application/octet-stream"));
		return res.sendFile(target);
	} catch (error) {
		console.error("GET /files/thumb/:uuid error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /files/download/:uuid
// ============================================
router.get("/files/download/:uuid", async (req, res) => {
	try {
		const file = await findAccessibleFile(req, req.params.uuid, "read");
		if (!file) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден" });
		}

		const filePath = path.resolve(UPLOAD_DIR, file.filePath);

		// Защита от path traversal — проверяем, что путь остаётся внутри UPLOAD_DIR
		if (!filePath.startsWith(UPLOAD_DIR)) {
			return res
				.status(403)
				.json({ success: false, message: "Доступ запрещён" });
		}

		if (!fs.existsSync(filePath)) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден на диске" });
		}

		return res.download(filePath, file.fileName);
	} catch (error) {
		console.error("GET /files/download error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /files/:uuid
// ============================================
router.delete("/files/:uuid", async (req, res) => {
	try {
		const file = await findAccessibleFile(req, req.params.uuid, "write");
		if (!file) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден" });
		}

		const filePath = path.resolve(UPLOAD_DIR, file.filePath);

		// Защита от path traversal
		if (!filePath.startsWith(UPLOAD_DIR)) {
			return res
				.status(403)
				.json({ success: false, message: "Доступ запрещён" });
		}

		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
		// Миниатюра лежит рядом (<файл>.thumb) — иначе осталась бы сиротой на диске.
		const thumbPath = `${filePath}.thumb`;
		if (fs.existsSync(thumbPath)) {
			fs.unlinkSync(thumbPath);
		}

		await prisma.attachedFile.delete({ where: { uuid: req.params.uuid }, ...(await fileOpts()) });

		return res.status(200).json({ success: true, message: "Файл удалён" });
	} catch (error) {
		console.error("DELETE /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PATCH /files/:uuid — обновление метаданных файла.
// Body { isMain: true } — пометить главным (comment="main"), сняв пометку с
// остальных файлов того же владельца. Либо { comment } — произвольный комментарий.
// (Используется блоком «Изображения товара»: главное фото хранится в comment.)
// ============================================
router.patch("/files/:uuid", async (req, res) => {
	try {
		const file = await findAccessibleFile(req, req.params.uuid, "write");
		if (!file) {
			return res.status(404).json({ success: false, message: "Файл не найден" });
		}

		const { isMain, comment } = req.body ?? {};

		if (isMain === true) {
			// Снимаем «main» с остальных файлов того же владельца и ставим этому.
			await prisma.attachedFile.updateMany({
				where: { ownerType: file.ownerType, ownerUuid: file.ownerUuid, comment: "main" },
				data: { comment: null },
			});
			const item = await prisma.attachedFile.update({
				where: { uuid: file.uuid },
				data: { comment: "main" },
				...(await fileOpts()),
			});
			return res.status(200).json({ success: true, item });
		}

		const item = await prisma.attachedFile.update({
			where: { uuid: file.uuid },
			data: { comment: comment ?? file.comment },
			...(await fileOpts()),
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("PATCH /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
