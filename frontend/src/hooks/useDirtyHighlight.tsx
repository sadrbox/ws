import { createContext, useContext, type FC, type ReactNode } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// CELL FIELD STATE — контекст состояния поля внутри ячейки таблицы.
// Передаёт required / error из Table → Field-компоненты, чтобы стили
// required/error применялись на FieldWrapper (не на TableBodyCell).
// ═══════════════════════════════════════════════════════════════════════════

export interface CellFieldState {
  required?: boolean;
  error?: boolean;
  errorMessage?: string;
}

const EMPTY_CELL_STATE: CellFieldState = {};
const CellFieldStateContext = createContext<CellFieldState>(EMPTY_CELL_STATE);

export const CellFieldStateScope: FC<{ value: CellFieldState; children: ReactNode }> = ({ value, children }) => (
  <CellFieldStateContext.Provider value={value}>
    {children}
  </CellFieldStateContext.Provider>
);

export const useCellFieldState = (): CellFieldState => useContext(CellFieldStateContext);
