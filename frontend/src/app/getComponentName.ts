// getComponentName вынесен из app/index.tsx, чтобы тот экспортировал только
// компонент App и был совместим с React Fast Refresh (HMR без полной
// перезагрузки страницы). Не-компонентный export в модуле-компоненте заставляет
// react-refresh делать full page reload.
import { isValidElement, type ReactElement } from "react";
import type { TComponentNode } from "./types";

/**
 * Имя компонента панели (для дедупликации панелей и подписей).
 * Поддерживает: строку-тег, функцию-компонент, React-элемент, а также
 * React.lazy/memo/forwardRef (объект с displayName).
 */
export const getComponentName = (node: TComponentNode): string => {
	if (node == null) return "Unknown";

	if (isValidElement(node)) {
		const type = (node as ReactElement).type;
		if (typeof type === "string") return type;
		if (typeof type === "function") {
			const fn = type as { displayName?: string; name?: string };
			return fn.displayName || fn.name || "AnonymousComponent";
		}
		return "UnknownElement";
	}

	if (typeof node === "function") {
		const fn = node as { displayName?: string; name?: string };
		return fn.displayName || fn.name || "AnonymousComponent";
	}

	if (typeof node === "object") {
		// React.lazy / memo / forwardRef: имя берётся из заданного displayName.
		// (lazy — это объект, а не функция, поэтому ветки выше его не ловят; без
		// этого все ленивые панели получали бы одно имя и схлопывались в одну.)
		const obj = node as { displayName?: string; type?: { displayName?: string } };
		if (obj.displayName) return obj.displayName;
		if (obj.type && obj.type.displayName) return obj.type.displayName;
	}
	return "NonComponent";
};
