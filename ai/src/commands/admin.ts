// Административные команды кластера 1С (E15/A3) — закрытый список.
//
// ЧЕМ ОТЛИЧАЮТСЯ ОТ БИЗНЕС-КОМАНД. Бизнес-команда идёт в базу через расширение bpapi и
// оперирует документами. Административная идёт мимо базы — через `rac` к службе RAS — и
// оперирует кластером: список ИБ, сеансы, соединения, блокировка входа. Вход в базу для
// этого не нужен, нужен администратор кластера. Поэтому исполняет их ДРУГОЙ агент
// (role=admin, отдельная служба под своей учёткой ОС), и путать эти два пути нельзя.
//
// ГЕЙТ (A6). Команда ставится только агенту, который сам объявил нужную способность в
// register.capabilities. Проверка здесь, до постановки в очередь: агент и так отвергнет
// незнакомую команду, но тогда пользователь узнает об этом через минуту таймаута вместо
// внятного отказа сразу.
//
// КЛАССЫ (§17). READ выполняется сразу; CRITICAL всегда проходит через карточку
// подтверждения — снятие сеанса и блокировка входа необратимы для того, кто в этот момент
// работает в базе.

import { z } from "zod";
import type { OperationClass } from "../tools/registry.ts";
import type { AgentRole, AgentView } from "../agents/service.ts";

export type AgentCapability = "cluster.admin" | "ib.admin";

export type AdminCommandSpec = {
	type: string;
	operation: OperationClass;
	capability: AgentCapability;
	role: AgentRole;
	/** Нужна ли конкретная база: для неё выбирается агент того сервера, где она живёт. */
	requiresBase: boolean;
	schema: z.ZodType<Record<string, unknown>>;
	/** Короткое описание для карточки подтверждения и аудита. */
	title: string;
};

const baseKey = z.string().min(1).max(200);
// Имя пользователя ИБ и имя расширения — то, чем 1С их адресует.
const ibName = z.string().min(1).max(200);

export const ADMIN_COMMANDS: AdminCommandSpec[] = [
	{
		type: "CLUSTER_LIST_INFOBASES",
		title: "Список баз кластера",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		schema: z.object({}).strict(),
	},
	{
		type: "CLUSTER_LIST_SESSIONS",
		title: "Сеансы",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Без baseKey — сеансы всего кластера; с ним — только этой базы.
		schema: z.object({ baseKey: baseKey.optional() }).strict(),
	},
	{
		type: "CLUSTER_LIST_CONNECTIONS",
		title: "Соединения",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		schema: z.object({ baseKey: baseKey.optional() }).strict(),
	},
	{
		type: "CLUSTER_INFOBASE_INFO",
		title: "Сведения о базе",
		operation: "READ",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "CLUSTER_TERMINATE_SESSION",
		title: "Снять сеанс",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: false,
		// Сеанс адресуется своим идентификатором кластера; baseKey нужен только для маршрутизации
		// к нужному серверу и для записи в аудит.
		schema: z.object({ sessionId: z.string().min(1).max(64), baseKey: baseKey.optional() }).strict(),
	},
	// ── Внутрибазовые операции (A3-P1). Идут НЕ через rac: агенту нужно войти в базу
	// (COM-соединение или расширение), поэтому отдельная способность ib.admin и
	// служебный администратор ИБ в каждой базе. Роль та же — admin.
	{
		type: "IB_LIST_USERS",
		title: "Пользователи базы",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_CREATE_USER",
		title: "Создать пользователя базы",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			name: ibName,
			fullName: z.string().max(200).optional(),
			// Пароль не логируется и не возвращается; пустой — вход без пароля (как в 1С).
			password: z.string().max(200).optional(),
			roles: z.array(z.string().max(200)).max(100).optional(),
			// Аутентификация ОС и признак «показывать в списке выбора».
			osUser: z.string().max(200).optional(),
			showInList: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_DELETE_USER",
		title: "Удалить пользователя базы",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey, name: ibName }).strict(),
	},
	{
		type: "IB_LIST_EXTENSIONS",
		title: "Расширения базы",
		operation: "READ",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey }).strict(),
	},
	{
		type: "IB_INSTALL_EXTENSION",
		title: "Установить расширение",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		// Файл .cfe передаётся телом команды: агент не ходит за ним в сеть.
		schema: z.object({
			baseKey,
			name: ibName,
			contentBase64: z.string().min(1),
			safeMode: z.boolean().optional(),
		}).strict(),
	},
	{
		type: "IB_DELETE_EXTENSION",
		title: "Удалить расширение",
		operation: "CRITICAL",
		capability: "ib.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({ baseKey, name: ibName }).strict(),
	},
	{
		type: "CLUSTER_SET_SESSIONS_LOCK",
		title: "Блокировка начала сеансов",
		operation: "CRITICAL",
		capability: "cluster.admin",
		role: "admin",
		requiresBase: true,
		schema: z.object({
			baseKey,
			enabled: z.boolean(),
			// Текст, который увидит пользователь при попытке войти, и окно блокировки.
			message: z.string().max(500).optional(),
			from: z.string().max(40).optional(),
			to: z.string().max(40).optional(),
			// Код разрешения: с ним можно войти в заблокированную базу (обслуживание).
			permissionCode: z.string().max(64).optional(),
		}).strict(),
	},
];

const BY_TYPE = new Map(ADMIN_COMMANDS.map((c) => [c.type, c]));

export function findAdminCommand(type: string): AdminCommandSpec | null {
	return BY_TYPE.get(type.toUpperCase()) ?? null;
}

export function isAdminCommand(type: string): boolean {
	return BY_TYPE.has(type.toUpperCase());
}

/**
 * Умеет ли агент выполнить команду. Способности объявляет сам агент при регистрации —
 * сервис им верит: способность не даёт прав, она лишь говорит, что служба умеет и настроена
 * (есть путь к `rac`, заданы адрес RAS и администратор кластера). Настоящее ограничение —
 * права учётной записи ОС, под которой служба работает.
 */
export function agentCanRun(agent: Pick<AgentView, "role" | "capabilities">, spec: AdminCommandSpec): boolean {
	return agent.role === spec.role && agent.capabilities.includes(spec.capability);
}

export type AdminPayloadResult =
	| { ok: true; payload: Record<string, unknown>; baseKey: string | null }
	| { ok: false; message: string };

/** Проверяет payload по схеме команды и достаёт из него ключ базы для маршрутизации. */
export function buildAdminPayload(spec: AdminCommandSpec, input: unknown): AdminPayloadResult {
	const parsed = spec.schema.safeParse(input ?? {});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, message: `${issue.path.join(".") || "payload"}: ${issue.message}` };
	}
	const payload = parsed.data as Record<string, unknown>;
	const key = typeof payload.baseKey === "string" ? payload.baseKey : null;
	if (spec.requiresBase && !key) return { ok: false, message: "baseKey: не указана база" };
	return { ok: true, payload, baseKey: key };
}
