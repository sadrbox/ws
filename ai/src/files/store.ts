// Хранилище файлов диалога (таблица chat_files).

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

export type StoredFile = {
	id: string;
	conversationId: string | null;
	organizationUuid: string;
	userUuid: string;
	fileName: string;
	mimeType: string;
	size: number;
	source: Record<string, unknown>;
	createdAt: Date;
	expiresAt: Date;
};

/** Описание файла для ответа клиенту (без содержимого). */
export type FileRef = { fileId: string; fileName: string; mimeType: string; size: number; url: string };

export class FileStore {
	private readonly db: Db;
	private readonly ttlDays: number;
	constructor(db: Db, ttlDays: number) {
		this.db = db;
		this.ttlDays = ttlDays;
	}

	async save(input: { conversationId: string | null; organizationUuid: string; userUuid: string; fileName: string; mimeType: string; content: Buffer; source?: Record<string, unknown> }): Promise<FileRef> {
		const id = randomUUID();
		await this.db.query(
			`INSERT INTO chat_files (id, conversation_id, organization_uuid, user_uuid, file_name, mime_type, size, content, source, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now() + ($10 || ' days')::interval)`,
			[id, input.conversationId, input.organizationUuid, input.userUuid, input.fileName, input.mimeType, input.content.length, input.content, JSON.stringify(input.source ?? {}), String(this.ttlDays)],
		);
		return { fileId: id, fileName: input.fileName, mimeType: input.mimeType, size: input.content.length, url: `/v1/files/${id}` };
	}

	/** Файл доступен только пользователям своей организации. */
	async get(id: string, organizationUuid: string): Promise<(StoredFile & { content: Buffer }) | null> {
		const r = await this.db.query<{ id: string; conversation_id: string | null; organization_uuid: string; user_uuid: string; file_name: string; mime_type: string; size: number; content: Buffer; source: Record<string, unknown>; created_at: Date; expires_at: Date }>(
			`SELECT * FROM chat_files WHERE id = $1 AND organization_uuid = $2 AND expires_at > now()`, [id, organizationUuid]);
		const x = r.rows[0];
		if (!x) return null;
		return { id: x.id, conversationId: x.conversation_id, organizationUuid: x.organization_uuid, userUuid: x.user_uuid, fileName: x.file_name, mimeType: x.mime_type, size: x.size, content: x.content, source: x.source, createdAt: x.created_at, expiresAt: x.expires_at };
	}

	async purgeExpired(): Promise<number> {
		const r = await this.db.query(`DELETE FROM chat_files WHERE expires_at <= now()`);
		return r.rowCount ?? 0;
	}
}
