// Хранилище распознанных первичных документов поставщиков (таблица purchase_documents).

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import type { PurchaseDocument, PurchaseCheck } from "./schema.ts";

export type PurchaseStatus = "extracted" | "matched" | "created" | "failed";

export type StoredPurchaseDocument = {
	id: string;
	conversationId: string | null;
	organizationUuid: string;
	userUuid: string;
	fileName: string;
	sha256: string;
	document: PurchaseDocument;
	check: PurchaseCheck;
	status: PurchaseStatus;
	matchResult: unknown;
	createResult: unknown;
	createdAt: Date;
};

type Row = {
	id: string; conversation_id: string | null; organization_uuid: string; user_uuid: string; file_name: string; file_sha256: string;
	document: PurchaseDocument; check_result: PurchaseCheck; status: PurchaseStatus; match_result: unknown; create_result: unknown; created_at: Date;
};

export class PurchaseDocumentStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	async save(input: Omit<StoredPurchaseDocument, "id" | "status" | "matchResult" | "createResult" | "createdAt">): Promise<StoredPurchaseDocument> {
		const id = randomUUID();
		const r = await this.db.query<Row>(
			`INSERT INTO purchase_documents (id, conversation_id, organization_uuid, user_uuid, file_name, file_sha256, document, check_result)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING *`,
			[id, input.conversationId, input.organizationUuid, input.userUuid, input.fileName, input.sha256, JSON.stringify(input.document), JSON.stringify(input.check)],
		);
		return map(r.rows[0]);
	}

	/** Документ доступен только в своей организации: чужой purchaseDocumentId не читается. */
	async get(id: string, organizationUuid: string): Promise<StoredPurchaseDocument | null> {
		const r = await this.db.query<Row>(`SELECT * FROM purchase_documents WHERE id = $1 AND organization_uuid = $2`, [id, organizationUuid]);
		return r.rows[0] ? map(r.rows[0]) : null;
	}

	/** Ответ сопоставления — основание для шага создания (правило 1 задачи И2). */
	async saveMatch(id: string, matchResult: unknown): Promise<void> {
		await this.db.query(`UPDATE purchase_documents SET status = 'matched', match_result = $2::jsonb, updated_at = now() WHERE id = $1`, [id, JSON.stringify(matchResult ?? null)]);
	}

	async markCreated(id: string, status: "created" | "failed", createResult: unknown): Promise<void> {
		await this.db.query(`UPDATE purchase_documents SET status = $2, create_result = $3::jsonb, updated_at = now() WHERE id = $1`, [id, status, JSON.stringify(createResult ?? null)]);
	}
}

function map(r: Row): StoredPurchaseDocument {
	return {
		id: r.id, conversationId: r.conversation_id, organizationUuid: r.organization_uuid, userUuid: r.user_uuid, fileName: r.file_name, sha256: r.file_sha256,
		document: r.document, check: r.check_result, status: r.status, matchResult: r.match_result, createResult: r.create_result, createdAt: r.created_at,
	};
}
