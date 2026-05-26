import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

export interface PermissionDefault {
	uuid: string;
	name: string;
}

export type PermissionDefaultsMap = Partial<Record<
	"bankAccount" | "contract" | "warehouse" | "cashbox" | "contact",
	PermissionDefault
>>;

export function useUserPermissionDefaults(
	userUuid: string,
	organizationUuid: string,
): PermissionDefaultsMap {
	const enabled = !!(userUuid && organizationUuid);

	const { data } = useQuery({
		queryKey: ["user-permission-defaults", userUuid, organizationUuid],
		queryFn: () =>
			api.get("/user-permission-defaults", {
				params: { userUuid, organizationUuid, limit: 100 },
			}),
		enabled,
		staleTime: 5 * 60 * 1000,
	});

	return useMemo(() => {
		const items: any[] = Array.isArray(data)
			? data
			: ((data as any)?.items ?? []);
		const map: PermissionDefaultsMap = {};
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
