// Канонический список функциональных модулей (E11). Должен совпадать с
// MODULE_KEYS в backend/services/moduleAccess.js. Отключение модуля на
// организацию убирает его разделы из меню и запрещает создавать документы
// (серверный гард moduleGuardMiddleware → 403 MODULE_DISABLED).
export interface ModuleDef {
  key: string;
  /** i18-ключ подписи модуля (переиспользуем существующие ключи разделов). */
  labelKey: string;
}

export const MODULES: ModuleDef[] = [
  { key: "sales", labelKey: "sales" },
  { key: "purchase", labelKey: "purchase" },
  { key: "warehouse", labelKey: "warehouse" },
  { key: "cash", labelKey: "cash" },
  { key: "hr", labelKey: "hr" },
  { key: "govdocs", labelKey: "govDocsSection" },
  { key: "edo", labelKey: "edoSection" },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
