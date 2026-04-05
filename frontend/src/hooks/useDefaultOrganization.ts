import { useMemo } from "react";
import { useAppContext } from "src/app";

/**
 * Возвращает организацию текущего пользователя (из employee.organization).
 * Используется для авто-заполнения поля «Организация» при создании новых документов.
 */
export function useDefaultOrganization(): {
	organizationUuid: string;
	organizationName: string;
} {
	const { auth } = useAppContext();
	return useMemo(() => {
		const org = auth.user?.employee?.organization;
		if (org?.uuid) {
			return {
				organizationUuid: org.uuid,
				organizationName: org.shortName || "",
			};
		}
		return { organizationUuid: "", organizationName: "" };
	}, [auth.user]);
}
