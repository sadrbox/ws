// React-контекст SubTable вынесен из index.tsx в отдельный модуль, чтобы
// index.tsx экспортировал ТОЛЬКО компоненты (SubTable, ReadOnlyCell) и был
// совместим с React Fast Refresh (HMR без полной перезагрузки страницы).
// Не-компонентные value-экспорты (хук/контекст) в модуле-компоненте заставляют
// react-refresh делать full page reload.
import { createContext, useContext } from "react";
import type { SubTableContext } from "./index";

// React Context для доступа к SubTableContext из дочерних элементов
// (например — из кнопок, переданных через extraButtons).
export const SubTableInternalContext = createContext<SubTableContext | null>(null);

/**
 * Хук для доступа к SubTableContext из любого компонента, отрендеренного
 * внутри SubTable (включая extraButtons). Возвращает null, если вызван
 * вне SubTable.
 */
export const useSubTableContext = (): SubTableContext | null =>
	useContext(SubTableInternalContext);
