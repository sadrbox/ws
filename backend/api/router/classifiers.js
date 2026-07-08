// HTTP-роутер классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС/…). Общий для
// гос-документов (ЭСФ/СНТ/ЭАВР). Чтение — всем авторизованным; импорт — суперадмин.
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { listClassifiers, importClassifiers } from "../../services/classifiers/index.js";
import { importClassifierXml } from "../../services/classifiers/importXml.js";

const router = express.Router();

// Загрузка XML-справочников (КАТО ~3 МБ, ГС ВС ~100 МБ) во временную папку.
const IMPORT_DIR = path.resolve("uploads/classifiers");
if (!fs.existsSync(IMPORT_DIR)) fs.mkdirSync(IMPORT_DIR, { recursive: true });
const importStorage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, IMPORT_DIR),
	filename: (_req, file, cb) => cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const importUpload = multer({ storage: importStorage, limits: { fileSize: 200 * 1024 * 1024 } });

// GET /classifiers?type=country&search=&parentCode= → список значений
router.get("/classifiers", async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	try {
		const { type, search, parentCode, limit } = req.query;
		if (!type) return res.status(400).json({ success: false, message: "Не указан type" });
		const items = await listClassifiers({ type: String(type), search: search ? String(search) : "", parentCode, limit });
		res.json({ success: true, items });
	} catch (err) {
		console.error("GET /classifiers error:", err);
		res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /classifiers/import { type, rows:[{code,name,parentCode?}] } — наполнение (суперадмин)
router.post("/classifiers/import", async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только для суперадмина" });
	try {
		const { type, rows } = req.body || {};
		if (!type || !Array.isArray(rows)) return res.status(400).json({ success: false, message: "Нужны type и rows[]" });
		const result = await importClassifiers(String(type), rows);
		res.json({ success: true, ...result });
	} catch (err) {
		console.error("POST /classifiers/import error:", err);
		res.status(500).json({ success: false, message: err?.message || "Ошибка импорта" });
	}
});

// POST /classifiers/import-file (multipart, поле file) — импорт из XML гос-системы
// (КАТО ValueTable / ГС ВС gsvsUpdates). Стриминг + bulk upsert. Только суперадмин.
router.post("/classifiers/import-file", importUpload.single("file"), async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только для суперадмина" });
	if (!req.file) return res.status(400).json({ success: false, message: "Файл не передан (поле file)" });
	try {
		const result = await importClassifierXml(req.file.path);
		res.json({ success: true, ...result });
	} catch (err) {
		console.error("POST /classifiers/import-file error:", err);
		res.status(400).json({ success: false, message: err?.message || "Ошибка импорта файла" });
	} finally {
		fs.promises.unlink(req.file.path).catch(() => {});
	}
});

export default router;
