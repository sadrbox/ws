import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Field.module.scss";
import { apiClient } from "src/services/api/client";
import { useDebounceValue } from "src/hooks/useDebounceValue";
import { useAppContext } from "src/app";
import SelectPaneWrapper from "./SelectPaneWrapper";
import { translate } from "src/i18";
import type { FieldVariant } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LookupFieldProps {
  /** Заголовок поля */
  label?: React.ReactNode;
  /** Имя поля для id/name */
  name: string;
  /** Текущий UUID (значение для хранения) */
  value?: string;
  /** Отображаемое значение (shortName, value и т.д.) */
  displayValue?: string;
  /** Колбэк при выборе элемента: (uuid, displayValue, item) */
  onSelect: (uuid: string, displayValue: string, item: Record<string, any>) => void;
  /** Колбэк при очистке */
  onClear?: () => void;
  /** Endpoint API, напр. "organizations", "counterparties", "contacttypes" */
  endpoint: string;
  /** Поле для отображения (по умолчанию "shortName") */
  displayField?: string;
  /** Дополнительные колонки (совместимость, не используется в новой версии) */
  columns?: { key: string; label: string }[];
  /** Ширина поля */
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  /** Заблокировано */
  disabled?: boolean;
  /** Placeholder */
  placeholder?: string;
  /** Компонент списка для модалки. Если не указан — используется маппинг по endpoint */
  listComponent?: FC<any>;
  /** Вариант отображения: default (форма) или table (внутри ячейки таблицы) */
  variant?: FieldVariant;
  /** Поля для отображения справа в автокомплите (напр. ["bin"] → показывает "(123456789012)").
   *  Поддерживает вложенные ключи через точку: "brand.shortName".
   *  Если не указан — берётся из defaultSecondaryFieldsMap по endpoint. */
  secondaryFields?: string[];
  /** Дополнительные query-параметры для фильтрации (передаются в autocomplete и SelectPaneWrapper).
   *  Например: { organizationUuid: "abc-123" } → ?organizationUuid=abc-123 */
  extraParams?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// МАППИНГ endpoint → *List компонент — перенесён в SelectPaneWrapper.tsx
// ═══════════════════════════════════════════════════════════════════════════

// ── Поля для отображения в выпадающем списке автокомплита ──────────────
// Ключ — endpoint, значение — массив полей, которые показываются
// справа в скобках рядом с основным displayField.
// Поддерживает вложенные ключи через точку: "brand.shortName"
const defaultSecondaryFieldsMap: Record<string, string[]> = {
  organizations: ["bin"],
  counterparties: ["bin", "iin"],
  products: ["sku", "brand.shortName"],
  employees: ["iin", "position"],
  users: ["employee.fullName"],
  contracts: ["documentNumber"],
  bankaccounts: ["iban"],
  currencies: ["code", "symbol"],
  contacttypes: [],
  warehouses: ["code"],
  brands: [],
};

// ── Ленивая загрузка Form-компонента по endpoint ──────────────────────
const formModuleRegistry: Record<string, () => Promise<any>> = {
  organizations: () => import("src/models/Organizations"),
  counterparties: () => import("src/models/Counterparties"),
  contacttypes: () => import("src/models/ContactTypes"),
  contactpersons: () => import("src/models/ContactPersons"),
  contacts: () => import("src/models/Contacts"),
  contracts: () => import("src/models/Contracts"),
  bankaccounts: () => import("src/models/BankAccounts"),
  users: () => import("src/models/Users"),
  activityhistories: () => import("src/models/ActivityHistories"),
  todos: () => import("src/models/Todos"),
  brands: () => import("src/models/Brands"),
  products: () => import("src/models/Products"),
  currencies: () => import("src/models/Currencies"),
  employees: () => import("src/models/Employees"),
  positions: () => import("src/models/Positions"),
  warehouses: () => import("src/models/Warehouses"),
  sales: () => import("src/models/Sales"),
  purchases: () => import("src/models/Purchases"),
  "incoming-invoices": () => import("src/models/IncomingInvoices"),
  "outgoing-invoices": () => import("src/models/OutgoingInvoices"),
  "payment-invoices": () => import("src/models/PaymentInvoices"),
  "cash-receipt-orders": () => import("src/models/CashReceiptOrders"),
  "cash-expense-orders": () => import("src/models/CashExpenseOrders"),
  "inventory-transfers": () => import("src/models/InventoryTransfers"),
  "scheduled-tasks": () => import("src/models/ScheduledTasks"),
  "access-rights": () => import("src/models/AccessRights"),
};

const formComponentNameMap: Record<string, string> = {
  organizations: "OrganizationsForm",
  counterparties: "CounterpartiesForm",
  contacttypes: "ContactTypesForm",
  contactpersons: "ContactPersonsForm",
  contacts: "ContactsForm",
  contracts: "ContractsForm",
  bankaccounts: "BankAccountsForm",
  users: "UsersForm",
  activityhistories: "ActivityHistoriesForm",
  todos: "TodosForm",
  brands: "BrandsForm",
  products: "ProductsForm",
  currencies: "CurrenciesForm",
  employees: "EmployeesForm",
  positions: "PositionsForm",
  warehouses: "WarehousesForm",
  sales: "SalesForm",
  purchases: "PurchasesForm",
  "incoming-invoices": "IncomingInvoicesForm",
  "outgoing-invoices": "OutgoingInvoicesForm",
  "payment-invoices": "PaymentInvoicesForm",
  "cash-receipt-orders": "CashReceiptOrdersForm",
  "cash-expense-orders": "CashExpenseOrdersForm",
  "inventory-transfers": "InventoryTransfersForm",
  "scheduled-tasks": "ScheduledTasksForm",
  "access-rights": "AccessRightsForm",
};

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP FIELD — поле с кнопками "выбор" и "очистить"
// Форма выбора открывается как отдельная Pane-вкладка через SelectPaneWrapper
// ═══════════════════════════════════════════════════════════════════════════

const LookupField: FC<LookupFieldProps> = ({
  label,
  name,
  value = "",
  displayValue = "",
  onSelect,
  onClear,
  endpoint,
  displayField = "shortName",
  columns: _columns,
  width,
  minWidth,
  maxWidth,
  disabled = false,
  placeholder,
  listComponent,
  variant = 'default',
  secondaryFields,
  extraParams,
}) => {
  // Подавляем неиспользуемые переменные совместимости
  void _columns;

  const { windows: { addPane } } = useAppContext();

  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

  // ── Autocomplete state ──────────────────────────────────────────────────
  const [inputText, setInputText] = useState(displayValue || "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedText = useDebounceValue(inputText, 300);

  // ── Portal dropdown position (for table variant) ──────────────────────
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!isTable || !isDropdownOpen || !wrapperRef.current) {
      setDropdownPos(null);
      return;
    }
    const updatePos = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    };
    updatePos();
    // Обновляем при скролле / ресайзе
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [isTable, isDropdownOpen]);

  // Синхронизация inputText с displayValue (при выборе или внешнем изменении)
  useEffect(() => {
    setInputText(displayValue || "");
  }, [displayValue]);

  // Запрос подсказок при изменении debounced текста
  useEffect(() => {
    // Не ищем если текст совпадает с уже выбранным значением
    if (!debouncedText || debouncedText === displayValue) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    apiClient
      .get(`/${endpoint}`, { params: { search: debouncedText, limit: 10, ...extraParams } })
      .then((res) => {
        if (cancelled) return;
        const items = res.data?.items ?? res.data?.data ?? res.data ?? [];
        setSuggestions(Array.isArray(items) ? items : []);
        setIsDropdownOpen(true);
        setActiveIndex(-1);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedText, endpoint, displayValue]);

  // Click-outside: закрытие dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current && !wrapperRef.current.contains(target) &&
          (!dropdownRef.current || !dropdownRef.current.contains(target))) {
        setIsDropdownOpen(false);
        // Если значение не выбрано — восстановить displayValue
        if (!value) {
          setInputText("");
        } else {
          setInputText(displayValue || "");
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, displayValue]);

  const handleOpenModal = useCallback(() => {
    if (disabled) return;
    addPane({
      component: SelectPaneWrapper,
      label: `Выбор: ${typeof label === "string" ? label : endpoint}`,
      isSelector: true,
      data: { endpoint, listComponent, extraParams } as any,
      onSelectResult: (item: Record<string, any>) => {
        const uuid = item.uuid as string;
        const display = String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? uuid);
        onSelect(uuid, display, item);
        setIsDropdownOpen(false);
        setInputText(display);
      },
    });
  }, [disabled, addPane, label, endpoint, listComponent, displayField, onSelect, extraParams]);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    const uuid = item.uuid as string;
    const display = String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? uuid);
    onSelect(uuid, display, item);
    setIsDropdownOpen(false);
    setInputText(display);
  }, [onSelect, displayField]);

  const handleClear = useCallback(() => {
    onSelect("", "", {});
    onClear?.();
    setInputText("");
    setSuggestions([]);
    setIsDropdownOpen(false);
  }, [onSelect, onClear]);

  // ── Открыть форму выбранного элемента ─────────────────────────────────
  const handleOpenItemForm = useCallback(() => {
    if (!value || disabled) return;
    const loader = formModuleRegistry[endpoint];
    if (!loader) return;
    const formName = formComponentNameMap[endpoint];
    loader().then((mod) => {
      const FormComp: FC<any> | undefined = mod[formName] || mod.default;
      if (!FormComp) return;
      const t = translate;
      addPane({
        label: `${t(formName) || endpoint}: ${displayValue || value}`,
        component: FormComp,
        data: { uuid: value } as any,
      });
    }).catch(() => { /* тихо игнорируем ошибку загрузки */ });
  }, [value, disabled, endpoint, displayValue, addPane]);

  // Выбор элемента из dropdown
  const handleSuggestionClick = useCallback((item: Record<string, any>) => {
    handleSelectItem(item);
  }, [handleSelectItem]);

  // Обработка ввода текста
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);
    // Если пользователь стирает текст — очистить выбранное значение
    if (!val && value) {
      onSelect("", "", {});
      onClear?.();
    }
    if (val) {
      setIsDropdownOpen(true);
    } else {
      setIsDropdownOpen(false);
      setSuggestions([]);
    }
  }, [value, onSelect, onClear]);

  // Навигация клавишами в dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || suggestions.length === 0) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        // При нажатии стрелки вниз без текста — открыть модалку
        if (!inputText && !disabled) {
          handleOpenModal();
        }
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        handleSuggestionClick(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
    }
  }, [isDropdownOpen, suggestions, activeIndex, inputText, disabled, handleOpenModal, handleSuggestionClick]);

  // Скроллинг активного элемента в видимую область dropdown
  useEffect(() => {
    if (activeIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll(`.${styles.LookupDropdownItem}`);
      items[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Действия для кнопок
  const fieldActions = useMemo(() => {
    if (disabled) return [];
    const acts: { type: "clear" | "list" | "open"; onClick: () => void }[] = [];
    if (value || inputText) {
      acts.push({ type: "clear", onClick: handleClear });
    }
    if (value && formModuleRegistry[endpoint]) {
      acts.push({ type: "open", onClick: handleOpenItemForm });
    }
    acts.push({ type: "list", onClick: handleOpenModal });
    return acts;
  }, [disabled, value, inputText, endpoint, handleClear, handleOpenItemForm, handleOpenModal]);

  // Получить отображаемое поле элемента
  const getItemDisplay = useCallback((item: Record<string, any>) => {
    return String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? item.uuid ?? "");
  }, [displayField]);

  // Вспомогательная: получить значение по ключу с поддержкой вложенности ("brand.shortName")
  const getNestedValue = useCallback((item: Record<string, any>, key: string): string => {
    const parts = key.split(".");
    let val: any = item;
    for (const p of parts) {
      if (val == null || typeof val !== "object") return "";
      val = val[p];
    }
    return val != null && typeof val !== "object" ? String(val) : "";
  }, []);

  // Определить итоговый набор вторичных полей:
  // 1) проп secondaryFields  2) маппинг по endpoint  3) пустой (ничего)
  const resolvedSecondaryFields = useMemo(() => {
    if (secondaryFields && secondaryFields.length > 0) return secondaryFields;
    return defaultSecondaryFieldsMap[endpoint] ?? [];
  }, [secondaryFields, endpoint]);

  // Получить вторичную строку для элемента автокомплита.
  // Формат: "БИН · Код" (через разделитель) — только непустые значения
  const getItemSecondary = useCallback((item: Record<string, any>) => {
    if (resolvedSecondaryFields.length === 0) return "";
    const parts: string[] = [];
    for (const field of resolvedSecondaryFields) {
      const v = getNestedValue(item, field);
      if (v) parts.push(v);
    }
    return parts.join(" · ");
  }, [resolvedSecondaryFields, getNestedValue]);

  return (
    <>
      <div
        className={wrapperClass}
        style={{
          width: width ?? "auto",
          maxWidth: maxWidth ?? "none",
          minWidth: minWidth ?? "none",
        }}
        ref={wrapperRef}
      >
        {!isTable && label && (
          <label htmlFor={name} className={styles.FieldLabel}>
            {label}
          </label>
        )}

        <div className={styles.FieldInputWrapper}>
          <input
            ref={inputRef}
            type="text"
            id={name}
            name={name}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              // При фокусе — если есть текст и нет выбранного значения, открыть dropdown
              if (inputText && !value && suggestions.length > 0) {
                setIsDropdownOpen(true);
              }
            }}
            className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ""}`}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? "Введите для поиска..."}
            onDoubleClick={handleOpenModal}
            style={{
              cursor: disabled ? "default" : "text",
              ...(fieldActions.length > 0 && {
                paddingRight: `${fieldActions.length * 32 + 8}px`,
              }),
            }}
          />

          {fieldActions.length > 0 && (
            <div className={styles.FieldActions}>
              {fieldActions.map((action, index) => {
                const iconData = {
                  clear: {
                    img: (
                      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3,3 L13,13 M13,3 L3,13" stroke="currentColor" strokeWidth="0.5" fill="none" strokeLinecap="round" />
                      </svg>
                    ),
                    alt: "Очистить",
                  },
                  list: {
                    img: (
                      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="3" width="14" height="1" fill="currentColor" rx="0.5" />
                        <rect x="1" y="6" width="14" height="1" fill="currentColor" rx="0.5" />
                        <rect x="1" y="9" width="14" height="1" fill="currentColor" rx="0.5" />
                        <rect x="1" y="12" width="14" height="1" fill="currentColor" rx="0.5" />
                      </svg>
                    ),
                    alt: "Выбрать из списка",
                  },
                  open: {
                    img: (
                      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" rx="0.5" />
                        <rect x="3" y="3" width="10" height="1" fill="currentColor" rx="0.5" />
                        <rect x="3" y="5" width="8" height="1" fill="currentColor" rx="0.5" />
                        <rect x="3" y="7" width="6" height="1" fill="currentColor" rx="0.5" />
                      </svg>
                    ),
                    alt: "Открыть",
                  },
                };
                const icon = iconData[action.type];
                return (
                  <button
                    key={index}
                    onClick={action.onClick}
                    type="button"
                    className={styles.FieldActionButton}
                    title={icon.alt}
                    tabIndex={-1}
                  >
                    {icon.img}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Autocomplete dropdown ───────────────────────────────────── */}
        {isDropdownOpen && (suggestions.length > 0 || isLoading) && !isTable && (
          <div className={styles.LookupDropdown} ref={dropdownRef}>
            {isLoading && suggestions.length === 0 && (
              <div className={styles.LookupDropdownLoading}>Поиск...</div>
            )}
            {suggestions.map((item, idx) => {
              const primary = getItemDisplay(item);
              const secondary = getItemSecondary(item);
              return (
                <div
                  key={item.uuid ?? idx}
                  className={`${styles.LookupDropdownItem} ${idx === activeIndex ? styles.LookupDropdownItemActive : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Не дать blur сработать раньше click
                    handleSuggestionClick(item);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span className={styles.LookupDropdownPrimary}>{primary}</span>
                  {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
                </div>
              );
            })}
            {!isLoading && suggestions.length === 0 && (
              <div className={styles.LookupDropdownLoading}>Ничего не найдено</div>
            )}
          </div>
        )}
      </div>

      {/* ── Portal dropdown for table variant ──────────────────────────── */}
      {isTable && isDropdownOpen && (suggestions.length > 0 || isLoading) && dropdownPos && createPortal(
        <div
          className={styles.LookupDropdown}
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
        >
          {isLoading && suggestions.length === 0 && (
            <div className={styles.LookupDropdownLoading}>Поиск...</div>
          )}
          {suggestions.map((item, idx) => {
            const primary = getItemDisplay(item);
            const secondary = getItemSecondary(item);
            return (
              <div
                key={item.uuid ?? idx}
                className={`${styles.LookupDropdownItem} ${idx === activeIndex ? styles.LookupDropdownItemActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSuggestionClick(item);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className={styles.LookupDropdownPrimary}>{primary}</span>
                {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
              </div>
            );
          })}
          {!isLoading && suggestions.length === 0 && (
            <div className={styles.LookupDropdownLoading}>Ничего не найдено</div>
          )}
        </div>,
        document.body,
      )}

    </>
  );
};

export default LookupField;
