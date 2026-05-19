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
// POST /files — загрузка файла
// ============================================
router.post("/files", upload.single("file"), async (req, res) => {
	try {
		const { ownerType, ownerUuid, comment } = req.body;
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

		await prisma.attachedFile.delete({ where: { uuid: req.params.uuid } });

		return res.status(200).json({ success: true, message: "Файл удалён" });
	} catch (error) {
		console.error("DELETE /files error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
