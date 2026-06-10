// API настроек нумерации документов: префикс и разрядность по виду документа.
// Глобально для установки. Экран «Настройки → Нумерация документов».
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { NUMBER_CONFIG, GLOBAL_SETTINGS_KEY, invalidateNumberSettingsCache } from "../../services/documentNumbering.js";

const router = express.Router();

// GET — список видов документов с действующим префиксом для организации.
// Query: organizationUuid (опц.) — без него возвращаются глобальные значения.
// Действующий префикс = настройка организации → глобальная → дефолт из кода.
router.get("/document-number-settings", async (req, res) => {
	try {
		const orgKey = req.query.organizationUuid ? String(req.query.organizationUuid) : GLOBAL_SETTINGS_KEY;
		const orgs = orgKey === GLOBAL_SETTINGS_KEY ? [GLOBAL_SETTINGS_KEY] : [GLOBAL_SETTINGS_KEY, orgKey];
		const rows = await prisma.documentNumberSetting.findMany({ where: { organizationUuid: { in: orgs } } });
		const globalByType = new Map(rows.filter((r) => r.organizationUuid === GLOBAL_SETTINGS_KEY).map((r) => [r.docType, r]));
		const orgByType = new Map(rows.filter((r) => r.organizationUuid === orgKey && orgKey !== GLOBAL_SETTINGS_KEY).map((r) => [r.docType, r]));
		const items = Object.entries(NUMBER_CONFIG).map(([docType, def]) => {
			const own = orgByType.get(docType);
			const glob = globalByType.get(docType);
			const eff = own ?? glob;
			return {
				docType,
				label: def.label,
				// Подсказка-префикс вида документа (опционально, не подставляется автоматически).
				defaultPrefix: def.prefix,
				prefix: eff?.prefix ?? "",
				padding: eff?.padding ?? 9,
				enabled: eff?.enabled ?? true,
				// Задано ли значение на уровне ЭТОЙ организации (а не глобально/дефолт).
				isOverridden: !!own,
			};
		});
		return res.json({ success: true, items, organizationUuid: orgKey });
	} catch (err) {
		console.error("GET /document-number-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT — задать префикс/разрядность вида документа для организации (или глобально).
router.put("/document-number-settings/:docType", async (req, res) => {
	try {
		const { docType } = req.params;
		if (!NUMBER_CONFIG[docType]) return res.status(400).json({ success: false, message: "Неизвестный вид документа" });
		const organizationUuid = req.body.organizationUuid ? String(req.body.organizationUuid) : GLOBAL_SETTINGS_KEY;
		const prefix = String(req.body.prefix ?? "").trim();
		const p = Number(req.body.padding);
		const padding = Number.isInteger(p) && p >= 1 && p <= 12 ? p : 9;
		const enabled = req.body.enabled === undefined ? true : !!req.body.enabled;
		const row = await prisma.documentNumberSetting.upsert({
			where: { organizationUuid_docType: { organizationUuid, docType } },
			create: { organizationUuid, docType, prefix, padding, enabled },
			update: { prefix, padding, enabled },
		});
		invalidateNumberSettingsCache();
		return res.json({ success: true, item: row });
	} catch (err) {
		console.error("PUT /document-number-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE — сбросить настройку вида документа к значению по умолчанию
// (удалить переопределение этой организации). Query: organizationUuid.
router.delete("/document-number-settings/:docType", async (req, res) => {
	try {
		const { docType } = req.params;
		const organizationUuid = req.query.organizationUuid ? String(req.query.organizationUuid) : GLOBAL_SETTINGS_KEY;
		await prisma.documentNumberSetting.deleteMany({ where: { organizationUuid, docType } });
		invalidateNumberSettingsCache();
		return res.json({ success: true });
	} catch (err) {
		console.error("DELETE /document-number-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
