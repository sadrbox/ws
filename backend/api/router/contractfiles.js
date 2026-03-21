import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

const UPLOAD_DIR = path.resolve("uploads/contracts");
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
// GET /contractfiles?contractUuid=xxx
// ============================================
router.get("/contractfiles", async (req, res) => {
	try {
		const { contractUuid } = req.query;
		if (!contractUuid) {
			return res
				.status(400)
				.json({ success: false, message: "contractUuid обязателен" });
		}

		const items = await prisma.contractFile.findMany({
			where: { contractUuid: String(contractUuid) },
			orderBy: { uploadedAt: "desc" },
		});

		return res.status(200).json({
			success: true,
			items,
			total: items.length,
		});
	} catch (error) {
		console.error("GET /contractfiles error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /contractfiles — загрузка файла
// ============================================
router.post("/contractfiles", upload.single("file"), async (req, res) => {
	try {
		const { contractUuid } = req.body;
		if (!contractUuid || !req.file) {
			return res
				.status(400)
				.json({ success: false, message: "contractUuid и file обязательны" });
		}

		const item = await prisma.contractFile.create({
			data: {
				contractUuid,
				fileName: req.file.originalname,
				filePath: req.file.filename,
				fileSize: req.file.size,
				mimeType: req.file.mimetype,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /contractfiles error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /contractfiles/download/:uuid
// ============================================
router.get("/contractfiles/download/:uuid", async (req, res) => {
	try {
		const file = await prisma.contractFile.findUnique({
			where: { uuid: req.params.uuid },
		});
		if (!file) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден" });
		}

		const filePath = path.join(UPLOAD_DIR, file.filePath);
		if (!fs.existsSync(filePath)) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден на диске" });
		}

		return res.download(filePath, file.fileName);
	} catch (error) {
		console.error("GET /contractfiles/download error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /contractfiles/:uuid
// ============================================
router.delete("/contractfiles/:uuid", async (req, res) => {
	try {
		const file = await prisma.contractFile.findUnique({
			where: { uuid: req.params.uuid },
		});
		if (!file) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден" });
		}

		const filePath = path.join(UPLOAD_DIR, file.filePath);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}

		await prisma.contractFile.delete({ where: { uuid: req.params.uuid } });

		return res.status(200).json({ success: true, message: "Файл удалён" });
	} catch (error) {
		console.error("DELETE /contractfiles error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
