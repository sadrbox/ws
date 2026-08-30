// Админ-роуты резервного копирования БД (E1.3). Только суперадмин.
import express from "express";
import { runBackup, listBackups } from "../../services/backup.js";

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

export default router;
