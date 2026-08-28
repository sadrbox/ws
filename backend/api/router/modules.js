// module-settings — чтение/запись списка отключённых модулей организации.
// Хранилище и семантика — в services/moduleAccess.js.
import express from "express";
import { MODULE_KEYS, getDisabledModules, setDisabledModules } from "../../services/moduleAccess.js";

const router = express.Router();

// GET /module-settings?organizationUuid=... → { modules:[все ключи], disabled:[...] }
router.get("/module-settings", async (req, res) => {
	try {
		const { organizationUuid } = req.query;
		const disabled = organizationUuid ? [...(await getDisabledModules(organizationUuid))] : [];
		return res.json({ success: true, modules: MODULE_KEYS, disabled });
	} catch (err) {
		console.error("GET /module-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT /module-settings { organizationUuid, disabled:[] } — только суперадмин.
router.put("/module-settings", async (req, res) => {
	try {
		if (!req.user?.isSuperAdmin) {
			return res.status(403).json({ success: false, message: "Недостаточно прав" });
		}
		const { organizationUuid, disabled } = req.body ?? {};
		if (!organizationUuid) {
			return res.status(400).json({ success: false, message: "organizationUuid обязателен" });
		}
		const clean = await setDisabledModules(organizationUuid, disabled);
		return res.json({ success: true, disabled: clean });
	} catch (err) {
		console.error("PUT /module-settings error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
