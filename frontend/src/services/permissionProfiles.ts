/**
 * Профили прав — именованные наборы доступа (О2 плана PLAN_INSTALL_MODES_2026-09-24.md).
 *
 * Определения живут на сервере (они часть поставки и версионируются вместе с моделями), панель
 * их только показывает и назначает. Свой список здесь заводить нельзя: разойдясь с серверным,
 * он пообещает доступ, которого не будет.
 */
import apiClient from "src/services/api/client";

export interface PermissionProfile {
	code: string;
	name: string;
	description?: string;
	/** Уровень для всего, что профиль не называет явно. */
	base: "none" | "readonly" | "full";
	isSystem: boolean;
}

export async function fetchPermissionProfiles(): Promise<PermissionProfile[]> {
	const res = await apiClient.get<{ success: boolean; data: { items: PermissionProfile[] } }>("/permission-profiles");
	return res.data?.data?.items ?? [];
}

/**
 * Назначить профиль. ПЕРЕЗАПИСЫВАЕТ права пользователя по этой организации целиком — иначе
 * результат был бы смесью нового профиля с остатками прежнего.
 */
export async function applyPermissionProfile(p: {
	userUuid: string;
	organizationUuid: string;
	profile: string;
	role?: string;
}): Promise<{ profile: string; applied: number | null }> {
	const res = await apiClient.post<{ success: boolean; data: { profile: string; applied: number | null } }>(
		"/permission-profiles/apply", p,
	);
	return res.data.data;
}
