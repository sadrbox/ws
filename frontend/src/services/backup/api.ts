// Резервное копирование БД (E1.3) — админ. См. backend/api/router/backup.js.
import { api } from "src/services/api/client";

export interface BackupFile { file: string; size: number; createdAt: string; }

export const fetchBackups = () =>
	api.get<{ success: boolean; items: BackupFile[] }>("/admin/backups");

export const createBackup = () =>
	api.post<{ success: boolean; backup: BackupFile }>("/admin/backup", {}, { timeout: 300_000 });
