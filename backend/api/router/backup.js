// Админ-роуты резервного копирования БД (E1.3). Только суперадмин.
import express from "express";
import { runBackup, listBackups } from "../../services/backup.js";
import { getSupportMode, enableSupportMode, disableSupportMode, operatorAccessMode } from "../../services/supportMode.js";
import { recordAudit } from "../../services/auditLog.js";

const router = express.Router();

function requireSuperAdmin(req, res) {
	if (!req.user?.isSuperAdmin) {
		res.status(403).json({ success: false, message: "Недостаточно прав" });
		return false;
	}
	return true;
}

// GET /admin/backups → список имеющихся дампов
router.get("/admin/backups", async (req, res) => {
	if (!requireSuperAdmin(req, res)) return;
	try {
		return res.json({ success: true, items: listBackups() });
	} catch (err) {
		console.error("GET /admin/backups error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /admin/backup → сделать новый дамп (pg_dump + gzip + ротация)
router.post("/admin/backup", async (req, res) => {
	if (!requireSuperAdmin(req, res)) return;
	try {
		const info = await runBackup();
		return res.json({ success: true, backup: info });
	} catch (err) {
		console.error("POST /admin/backup error:", err);
		return res.status(500).json({ success: false, message: err?.message || "Ошибка резервного копирования" });
	}
});

/*
 * РЕЖИМ ПОДДЕРЖКИ (О5): оператор открывает себе учётные данные НА ВРЕМЯ и с причиной.
 *
 * Живёт рядом с бэкапами, потому что это тот же раздел «Администрирование установки» и та же
 * проверка суперадмина. Отдельного роутера ради двух маршрутов заводить незачем.
 */
router.get("/admin/support-mode", async (req, res) => {
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Недостаточно прав" });
	const state = await getSupportMode();
	return res.json({ success: true, data: { mode: operatorAccessMode(), active: !!state, ...(state ?? {}) } });
});

router.post("/admin/support-mode", async (req, res) => {
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Недостаточно прав" });
	const { minutes, reason, enable = true } = req.body ?? {};
	if (enable && !String(reason ?? "").trim()) {
		// Без причины запись в журнале бесполезна: «кто-то заходил, зачем — неизвестно».
		return res.status(400).json({ success: false, message: "Укажите причину доступа к данным" });
	}
	const state = enable
		? await enableSupportMode({ by: req.user?.username ?? null, reason, minutes })
		: (await disableSupportMode(), null);

	void recordAudit({
		actionType: enable ? "support_mode_enabled" : "support_mode_disabled",
		objectType: "Installation",
		objectId: "support-mode",
		objectName: "Режим поддержки",
		organizationUuid: null,
		user: { uuid: req.user?.uuid ?? null, username: req.user?.username ?? null },
		props: state ? { until: state.until, reason: state.reason } : null,
		host: req?.hostname ?? null,
		ip: req?.ip ?? null,
	});
	return res.json({ success: true, data: { active: !!state, ...(state ?? {}) } });
});

export default router;
