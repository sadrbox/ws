import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

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

		const items = await prisma.attachedFile.findMany({
			where: {
				ownerType: String(ownerType),
				ownerUuid: String(ownerUuid),
			},
			orderBy: { uploadedAt: "desc" },
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
router.get("/files/all", async (_req, res) => {
	try {
		const items = await prisma.attachedFile.findMany({
			where: { deletedAt: null },
			orderBy: { uploadedAt: "desc" },
		});
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
			return res.status(400).json({
				success: false,
				message: "ownerType, ownerUuid и file обязательны",
			});
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

		const item = await prisma.attachedFile.create({
			data: {
				ownerType,
				ownerUuid,
				fileName,
				filePath: req.file.filename,
				fileSize: req.file.size,
				mimeType: req.file.mimetype,
				comment: comment || null,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
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
		const file = await prisma.attachedFile.findUnique({
			where: { uuid: req.params.uuid },
		});
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
		const file = await prisma.attachedFile.findUnique({
			where: { uuid: req.params.uuid },
		});
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
		const file = await prisma.attachedFile.findUnique({
			where: { uuid: req.params.uuid },
		});
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

		await prisma.attachedFile.delete({ where: { uuid: req.params.uuid } });

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
		const file = await prisma.attachedFile.findUnique({
			where: { uuid: req.params.uuid },
		});
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
			});
			return res.status(200).json({ success: true, item });
		}

		const item = await prisma.attachedFile.update({
			where: { uuid: file.uuid },
			data: { comment: comment ?? file.comment },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("PATCH /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
