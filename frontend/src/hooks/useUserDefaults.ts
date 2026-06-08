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

export function useUserDefaults(
	userUuid: string,
	organizationUuid: string,
): UserDefaultsMap {
	const enabled = !!(userUuid && organizationUuid);

	const { data } = useQuery({
		queryKey: ["user-defaults", userUuid, organizationUuid],
		queryFn: () =>
			api.get("/user-defaults", {
				params: { userUuid, organizationUuid, limit: 100 },
			}),
		enabled,
		staleTime: 5 * 60 * 1000,
	});

	return useMemo(() => {
		const items: any[] = Array.isArray(data)
			? data
			: ((data as any)?.items ?? []);
		const map: UserDefaultsMap = {};
		for (const item of items) {
			if (item.valueType && item.valueUuid) {
				(map as any)[item.valueType] = {
					uuid: item.valueUuid,
					name: item.valueName ?? "",
				};
			}
		}
		return map;
	}, [data]);
}
