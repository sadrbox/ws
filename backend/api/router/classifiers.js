// HTTP-роутер классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС/…). Общий для
// гос-документов (ЭСФ/СНТ/ЭАВР). Чтение — всем авторизованным; импорт — суперадмин.
import express from "express";
import { listClassifiers, importClassifiers } from "../../services/classifiers/index.js";

const router = express.Router();

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

export default router;
