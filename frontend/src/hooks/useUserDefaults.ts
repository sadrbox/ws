import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

export interface UserDefault {
	uuid: string;
	name: string;
}

export type UserDefaultsMap = Partial<Record<
	"bankAccount" | "contract" | "warehouse" | "cashbox" | "contact" | "salePriceType" | "purchasePriceType",
	UserDefault
>>;

/** Запись основного значения пользователя (ответ user-defaults). */
interface UserDefaultRecord {
	valueType?: string;
	valueUuid?: string;
	valueName?: string | null;
}

export function useUserDefaults(
	userUuid: string,
	organizationUuid: string,
): UserDefaultsMap {
	const enabled = !!(userUuid && organizationUuid);

	const { data } = useQuery({
		queryKey: ["user-defaults", userUuid, organizationUuid],
		queryFn: () =>
			api.get<UserDefaultRecord[] | { items?: UserDefaultRecord[] }>("/user-defaults", {
				params: { userUuid, organizationUuid, limit: 100 },
			}),
		enabled,
		staleTime: 5 * 60 * 1000,
	});

	return useMemo(() => {
		const items: UserDefaultRecord[] = Array.isArray(data)
			? data
			: (data?.items ?? []);
		const map: UserDefaultsMap = {};
		for (const item of items) {
			if (item.valueType && item.valueUuid) {
				(map as Record<string, UserDefault>)[item.valueType] = {
					uuid: item.valueUuid,
					name: item.valueName ?? "",
				};
			}
		}
		return map;
	}, [data]);
}
