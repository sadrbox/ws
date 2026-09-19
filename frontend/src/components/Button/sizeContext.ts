/**
 * РАЗМЕР КНОПОК ПО УМОЛЧАНИЮ ДЛЯ ОБЛАСТИ ЭКРАНА (19.09).
 *
 * Шапку панели (PaneItemHeaderToolbar) наполняют разные формы через usePaneHeaderActions: «Печать», «Заметки»,
 * «Показать в списке». Проставлять `size="sm"` в каждой значило бы получить шапку, где одна забытая кнопка крупнее
 * соседей. Область задаёт размер одним провайдером; явный `size` у кнопки по-прежнему главнее. Одиночные
 * кнопки-иконки (IconButton) этим не управляются — у них свой размер.
 *
 * Отдельным модулем: не-компонентный экспорт в модуле с компонентом ломает Fast Refresh.
 */
import { createContext } from "react";

export type ButtonSize = "sm" | "md" | "lg" | "min";

export const ButtonSizeContext = createContext<ButtonSize | undefined>(undefined);
