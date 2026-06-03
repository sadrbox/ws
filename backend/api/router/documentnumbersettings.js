// API настроек нумерации документов: префикс и разрядность по виду документа.
// Глобально для установки. Экран «Настройки → Нумерация документов».
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { NUMBER_CONFIG, invalidateNumberSettingsCache } from "../../services/documentNumbering.js";

const router = express.Router();

// GET — список всех видов документов с текущим префиксом (override или дефолт).
router.get("/document-number-settings", async (req, res) => {
	try {
		const rows = await prisma.documentNumberSetting.findMany();
		const byType = new Map(rows.map((r) => [r.docType, r]));
		const items = Object.entries(NUMBER_CONFIG).map(([docType, def]) => {
			const r = byType.get(docType);
			return {
				docType,
				label: def.label,
				defaultPrefix: def.prefix,
				prefix: r?.prefix ?? def.prefix,
				padding: r?.padding ?? 6,
				isOverridden: !!r,
			};
		});
		return res.json({ success: true, items });
	} catch (err) {
		console.error("GET /document-number-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT — переопределить префикс/разрядность для вида документа.
router.put("/document-number-settings/:docType", async (req, res) => {
	try {
		const { docType } = req.params;
		if (!NUMBER_CONFIG[docType]) return res.status(400).json({ success: false, message: "Неизвестный вид документа" });
		const prefix = String(req.body.prefix ?? "").trim();
		if (!prefix) return res.status(400).json({ success: false, message: "Префикс обязателен" });
		const p = Number(req.body.padding);
		const padding = Number.isInteger(p) && p >= 1 && p <= 12 ? p : 6;
		const row = await prisma.documentNumberSetting.upsert({
			where: { docType },
			create: { docType, prefix, padding },
			update: { prefix, padding },
		});
		invalidateNumberSettingsCache();
		return res.json({ success: true, item: row });
	} catch (err) {
		console.error("PUT /document-number-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
