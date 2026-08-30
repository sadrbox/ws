// Хранилище распознанных выписок (таблица bank_statements).

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import type { Statement, Reconciliation } from "./schema.ts";

export type StoredStatement = {
	id: string;
	conversationId: string | null;
	organizationUuid: string;
	userUuid: string;
	fileName: string;
	sha256: string;
	statement: Statement;
	reconciliation: Reconciliation;
	status: "extracted" | "imported" | "failed";
	importResult: unknown;
	createdAt: Date;
};

type Row = { id: string; conversation_id: string | null; organization_uuid: string; user_uuid: string; file_name: string; file_sha256: string; statement: Statement; reconciliation: Reconciliation; status: StoredStatement["status"]; import_result: unknown; created_at: Date };

export class StatementStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	async save(input: Omit<StoredStatement, "id" | "status" | "importResult" | "createdAt">): Promise<StoredStatement> {
		const id = randomUUID();
		const r = await this.db.query<Row>(
			`INSERT INTO bank_statements (id, conversation_id, organization_uuid, user_uuid, file_name, file_sha256, statement, reconciliation)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING *`,
			[id, input.conversationId, input.organizationUuid, input.userUuid, input.fileName, input.sha256, JSON.stringify(input.statement), JSON.stringify(input.reconciliation)],
		);
		return map(r.rows[0]);
	}

	/** Выписка доступна только в своей организации: чужой statementId не читается. */
	async get(id: string, organizationUuid: string): Promise<StoredStatement | null> {
		const r = await this.db.query<Row>(`SELECT * FROM bank_statements WHERE id = $1 AND organization_uuid = $2`, [id, organizationUuid]);
		return r.rows[0] ? map(r.rows[0]) : null;
	}

	async markImported(id: string, status: StoredStatement["status"], importResult: unknown): Promise<void> {
		await this.db.query(`UPDATE bank_statements SET status = $2, import_result = $3::jsonb, updated_at = now() WHERE id = $1`, [id, status, JSON.stringify(importResult ?? null)]);
	}
}

function map(r: Row): StoredStatement {
	return { id: r.id, conversationId: r.conversation_id, organizationUuid: r.organization_uuid, userUuid: r.user_uuid, fileName: r.file_name, sha256: r.file_sha256, statement: r.statement, reconciliation: r.reconciliation, status: r.status, importResult: r.import_result, createdAt: r.created_at };
}
