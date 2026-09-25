/**
 * Группы сотрудников (E17 СК0.2) — чистые правила формы: состав группы и тело запроса.
 *
 * Сервер (backend/api/router/staffGroups.js) при сохранении ЗАМЕНЯЕТ участников и клиентов
 * целиком: форма обязана присылать весь состав — `members` (uuid пользователей) и `clients`
 * ({clientOrganizationUuid, responsibleUuid}). Отправить только изменения значило бы стереть
 * остальных.
 */

export interface MemberRow {
	userUuid: string;
	userName: string;
}

export interface ClientRow {
	clientOrganizationUuid: string;
	clientName: string;
	responsibleUuid: string;
	responsibleName: string;
}

export interface StaffGroupFields {
	name: string;
	headUuid: string;
	managerUuid: string;
	comment: string;
	members: MemberRow[];
	clients: ClientRow[];
}

/** Серверная запись группы (GET /staff-groups/:id) — вход mapServerToForm. */
export interface StaffGroupRecord {
	id?: number;
	uuid?: string;
	name?: string | null;
	headUuid?: string | null;
	headName?: string | null;
	managerUuid?: string | null;
	managerName?: string | null;
	comment?: string | null;
	members?: { userUuid: string; userName?: string | null }[];
	clients?: { clientOrganizationUuid: string; clientName?: string | null; responsibleUuid?: string | null; responsibleName?: string | null }[];
	canEdit?: boolean;
}

export function membersOf(d: StaffGroupRecord): MemberRow[] {
	return (d.members ?? []).map((m) => ({ userUuid: m.userUuid, userName: m.userName || m.userUuid }));
}

export function clientsOf(d: StaffGroupRecord): ClientRow[] {
	return (d.clients ?? []).map((c) => ({
		clientOrganizationUuid: c.clientOrganizationUuid,
		clientName: c.clientName || c.clientOrganizationUuid,
		responsibleUuid: c.responsibleUuid ?? "",
		responsibleName: c.responsibleName ?? "",
	}));
}

/** Добавить участника; повтор не добавляется (сервер тоже схлопнул бы дубль). */
export function addMember(list: MemberRow[], m: MemberRow): MemberRow[] {
	if (!m.userUuid || list.some((x) => x.userUuid === m.userUuid)) return list;
	return [...list, m];
}

export function removeMember(list: MemberRow[], userUuid: string): MemberRow[] {
	return list.filter((m) => m.userUuid !== userUuid);
}

/** Добавить клиента; один клиент — одна строка (у клиента группы один ответственный). */
export function addClient(list: ClientRow[], c: Pick<ClientRow, "clientOrganizationUuid" | "clientName">): ClientRow[] {
	if (!c.clientOrganizationUuid || list.some((x) => x.clientOrganizationUuid === c.clientOrganizationUuid)) return list;
	return [...list, { ...c, responsibleUuid: "", responsibleName: "" }];
}

export function removeClient(list: ClientRow[], clientOrganizationUuid: string): ClientRow[] {
	return list.filter((c) => c.clientOrganizationUuid !== clientOrganizationUuid);
}

export function setResponsible(list: ClientRow[], clientOrganizationUuid: string, responsibleUuid: string, responsibleName: string): ClientRow[] {
	return list.map((c) => (c.clientOrganizationUuid === clientOrganizationUuid ? { ...c, responsibleUuid, responsibleName } : c));
}

/**
 * Ключ ошибки или null. Главбух и руководитель — разные люди: нарушение главбуха подтверждает
 * руководитель, и совмещение ролей сделало бы главбуха судьёй самому себе (сервер откажет так же).
 */
export function validateStaffGroup(f: StaffGroupFields): string | null {
	if (!f.name.trim()) return "staffGroupNeedName";
	if (f.headUuid && f.headUuid === f.managerUuid) return "staffGroupHeadIsManager";
	return null;
}

export function staffGroupPayload(f: StaffGroupFields): Record<string, unknown> {
	return {
		name: f.name.trim(),
		headUuid: f.headUuid || null,
		managerUuid: f.managerUuid || null,
		comment: f.comment.trim() || null,
		members: f.members.map((m) => m.userUuid),
		clients: f.clients.map((c) => ({ clientOrganizationUuid: c.clientOrganizationUuid, responsibleUuid: c.responsibleUuid || null })),
	};
}
