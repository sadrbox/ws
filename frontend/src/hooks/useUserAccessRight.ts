import { useMemo } from "react";
import { useAppContext } from "src/app";

export type AccessLevel = "full" | "readonly" | "none";

export interface UserAccessRightResult {
	/** Уровень доступа: "full" | "readonly" | "none" */
	accessLevel: AccessLevel;
	/** Есть ли доступ на чтение (full или readonly) */
	canRead: boolean;
	/** Есть ли доступ на запись (только full) */
	canWrite: boolean;
}

/**
 * Хук для проверки прав текущего пользователя на модель.
 *
 * @param modelName — имя модели в PascalCase (как в UserAccessRight.modelName).
 *   Примеры: "Organization", "Sale", "BankAccount", "Employee".
 *
 * @returns { accessLevel, canRead, canWrite }
 *
 * Логика:
 *   - Если пользователь не залогинен → "none"
 *   - Если isSuperAdmin → "full"
 *   - Иначе ищет запись в userAccessRights по modelName
 *   - Если записи нет → "none"
 */
export function useUserAccessRight(modelName: string): UserAccessRightResult {
	const user = useAppContext().auth.user;

	return useMemo(() => {
		if (!user) return { accessLevel: "none" as const, canRead: false, canWrite: false };
		if (user.isSuperAdmin) return { accessLevel: "full" as const, canRead: true, canWrite: true };

		const rights = user.userAccessRights ?? user.employee?.userAccessRights ?? [];
		const entry = rights.find((r) => r.modelName === modelName);
		const level = (entry?.accessLevel ?? "none") as AccessLevel;

		return {
			accessLevel: level,
			canRead: level === "full" || level === "readonly",
			canWrite: level === "full",
		};
	}, [user, modelName]);
}

/**
 * Хелпер (не хук) — для использования вне React-компонентов.
 * Принимает массив userAccessRights напрямую.
 */
export function getAccessLevel(
	userAccessRights: { modelName: string; accessLevel: string }[] | undefined,
	modelName: string,
	isSuperAdmin?: boolean,
): UserAccessRightResult {
	if (isSuperAdmin) return { accessLevel: "full", canRead: true, canWrite: true };
	const entry = userAccessRights?.find((r) => r.modelName === modelName);
	const level = (entry?.accessLevel ?? "none") as AccessLevel;
	return {
		accessLevel: level,
		canRead: level === "full" || level === "readonly",
		canWrite: level === "full",
	};
}
