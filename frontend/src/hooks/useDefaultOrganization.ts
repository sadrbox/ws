import { useMemo } from "react";
import { useAppContext } from "src/app/context";

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
			const orgName =
				user.userSettings?.find(
					(up) => up.organizationUuid === user.organizationUuid,
				)?.organization?.name ||
				user.employee?.organization?.name ||
				"";
			return {
				organizationUuid: user.organizationUuid,
				organizationName: orgName,
			};
		}
		return { organizationUuid: "", organizationName: "" };
	}, [auth.user]);
}
