import { useEffect, useRef } from "react";
import type { PermissionDefaultsMap } from "./useUserPermissionDefaults";

export interface PermissionDefaultFieldMapping {
	type: keyof PermissionDefaultsMap;
	uuidKey: string;
	nameKey: string;
}

/**
 * Применяет предопределённые значения (договор, склад, касса, банковский счёт)
 * к новой форме документа при первом появлении данных или смене организации.
 *
 * Срабатывает только для новых документов (isEditMode=false).
 * Применяет только пустые поля — не затирает уже выбранные пользователем.
 * Использует setFieldsInitial, поэтому форма не помечается как dirty.
 */
export function useApplyPermissionDefaults(opts: {
	defaults: PermissionDefaultsMap;
	organizationUuid: string;
	isEditMode: boolean;
	isLoading: boolean;
	fieldMappings: PermissionDefaultFieldMapping[];
	currentValues: Record<string, string>;
	apply: (fields: Record<string, string>) => void;
}) {
	const {
		defaults,
		organizationUuid,
		isEditMode,
		isLoading,
		fieldMappings,
		currentValues,
		apply,
	} = opts;

	const applyRef = useRef(apply);
	applyRef.current = apply;

	const currentValuesRef = useRef(currentValues);
	currentValuesRef.current = currentValues;

	const handledRef = useRef<string | null>(null);

	useEffect(() => {
		if (isEditMode || isLoading) return;
		if (!organizationUuid) return;

		const cacheKey = `${organizationUuid}:${JSON.stringify(defaults)}`;
		if (handledRef.current === cacheKey) return;
		if (Object.keys(defaults).length === 0) return;

		handledRef.current = cacheKey;

		const patch: Record<string, string> = {};
		for (const mapping of fieldMappings) {
			const def = defaults[mapping.type];
			if (!def) continue;
			const current = currentValuesRef.current[mapping.uuidKey] ?? "";
			if (current) continue;
			patch[mapping.uuidKey] = def.uuid;
			patch[mapping.nameKey] = def.name;
		}

		if (Object.keys(patch).length > 0) {
			applyRef.current(patch);
		}
	}, [defaults, organizationUuid, isEditMode, isLoading, fieldMappings]);
}
