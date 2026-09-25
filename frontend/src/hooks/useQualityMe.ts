/**
 * useQualityMe — контекст учёта качества (E17): организация-фирма и роль пользователя
 * (главбух, руководитель, администратор) по группам сотрудников.
 *
 * Роль задают группы, а не права на модели, поэтому меню и кнопки раздела «Качество»
 * смотрят сюда, а не в useAccessPermission. Сервер всё равно проверяет каждое действие —
 * здесь только то, что показывать.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchQualityMe, type QualityMe } from "src/services/quality/api";

export const QUALITY_ME_KEY = ["quality", "me"] as const;

export function useQualityMe(enabled = true) {
	const q = useQuery({
		queryKey: QUALITY_ME_KEY,
		queryFn: fetchQualityMe,
		staleTime: 60_000,
		enabled,
		retry: false,
	});
	const me: QualityMe | undefined = q.data;
	return {
		me,
		isLoading: q.isLoading,
		refetch: q.refetch,
		/** Главбух, руководитель или администратор: панели и решения по нарушениям. */
		isController: !!me && (me.isAdmin || me.isHead || me.isManager),
		canManage: !!me?.canManage,
	};
}
