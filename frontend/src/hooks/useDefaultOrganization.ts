import { useMemo } from "react";
import { useAppContext } from "src/app";

/**
 * Возвращает организацию текущего пользователя (из user.organizationUuid).
 * Используется для авто-заполнения поля «Организация» при создании новых документов.
 */
export function useDefaultOrganization(): {
	organizationUuid: string;
	organizationName: string;
} {
	const { auth } = useAppContext();
	return useMemo(() => {
		const user = auth.user;
		// Берём organizationUuid непосредственно из пользователя
		if (user?.organizationUuid) {
			// Название организации — из employee.organization (если есть) или пустая строка
			const orgName = user.employee?.organization?.shortName || "";
			return {
				organizationUuid: user.organizationUuid,
				organizationName: orgName,
			};
		}
		return { organizationUuid: "", organizationName: "" };
	}, [auth.user]);
}
