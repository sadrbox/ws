import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Field.module.scss";
import { fetchList } from "src/services/offlineDataService";
import { useDebounceValue } from "src/hooks/useDebounceValue";
import { useAppContext } from "src/app";
import SelectPaneWrapper from "./SelectPaneWrapper";
import FieldActionButton from "./FieldActionButton";
import type { IconName } from "src/components/IconButton/icons";
import { translate } from "src/i18";
import type { FieldVariant } from "./index";
// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type LookupActionType = "clear" | "open" | "quickselect" | "list";

// Карта тип-действия → иконка из общего реестра + подпись.
// fieldActions описывают только тип, обработчик, состояние и tooltip —
// визуал (SVG, размеры, hover/focus) полностью инкапсулирован
// в FieldActionButton/IconButton.
const FIELD_ACTION_META: Record<LookupActionType, { icon: IconName; label: string }> = {
  clear: { icon: "clear", label: "Очистить" },
  quickselect: { icon: "quickselect", label: "Быстрый выбор" },
  list: { icon: "list", label: "Выбрать из списка" },
  open: { icon: "open", label: "Открыть" },
};

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
  /** Какие кнопки показывать. По умолчанию — все доступные.
   *  Пример: ["quickselect"] — только кнопка быстрого выбора. */
  visibleActions?: LookupActionType[];
  /**
   * Вызывается когда пользователь нажимает Enter в поле без активного пункта дропдауна
   * (сигнал для перехода на следующее поле в строке).
   */
  onEnterKey?: () => void;
  /**
   * Вызывается после того, как пользователь выбрал элемент из модального окна (SelectPane).
   * Используется для перехода фокуса на следующее поле.
   */
  onAfterSelect?: () => void;
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

// ── Ленивая загрузка Form-компонента по endpoint (через единый реестр) ──
import { getByEndpoint } from "src/registry/modelRegistry";

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP FIELD — поле с кнопками "выбор" и "очистить"
// Форма выбора открывается как отдельная PaneItem-вкладка через SelectPaneWrapper
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
  visibleActions,
  onEnterKey,
  onAfterSelect,
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
    fetchList(endpoint, undefined, { search: debouncedText, limit: 10, ...extraParams })
      .then((result) => {
        if (cancelled) return;
        setSuggestions(result.items as any[]);
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
      label: `Выбор: ${(typeof label === "string" && label.trim()) ? label : (getByEndpoint(endpoint)?.label ?? endpoint)}`,
      isSelector: true,
      data: { endpoint, listComponent, extraParams } as any,
      onSelectResult: (item: Record<string, any>) => {
        const uuid = item.uuid as string;
        const display = String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? uuid);
        onSelect(uuid, display, item);
        setIsDropdownOpen(false);
        setInputText(display);
        // Переводим фокус на следующее поле после закрытия модалки.
        // Сначала фокусируем собственный input (document.activeElement = наш input),
        // чтобы focusNextInRow() мог найти tr и следующее поле.
        if (onAfterSelect) {
          setTimeout(() => {
            const ownInput = wrapperRef.current?.querySelector<HTMLInputElement>('input');
            if (ownInput) ownInput.focus();
            onAfterSelect();
          }, 50);
        }
      },
    });
  }, [disabled, addPane, label, endpoint, listComponent, displayField, onSelect, extraParams, onAfterSelect]);

  // ── Быстрый выбор — загружает все записи и открывает inline dropdown ──
  const handleQuickSelect = useCallback(() => {
    if (disabled) return;
    setIsLoading(true);
    fetchList(endpoint, undefined, { limit: 200, ...extraParams })
      .then((result) => {
        setSuggestions(result.items as any[]);
        setIsDropdownOpen(true);
        setActiveIndex(-1);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setIsLoading(false));
  }, [disabled, endpoint, extraParams]);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    const uuid = item.uuid as string;
    const display = String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? uuid);
    onSelect(uuid, display, item);
    setIsDropdownOpen(false);
    setInputText(display);
    // После выбора из inline-dropdown ("Быстрый выбор" / автокомплит) переводим
    // фокус на следующее поле текущей строки, как и при выборе из модальной формы.
    if (onAfterSelect) {
      setTimeout(() => {
        const ownInput = wrapperRef.current?.querySelector<HTMLInputElement>('input');
        if (ownInput) ownInput.focus();
        onAfterSelect();
      }, 0);
    }
  }, [onSelect, displayField, onAfterSelect]);

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
    const entry = getByEndpoint(endpoint);
    if (!entry) return;
    entry.module().then((mod) => {
      const FormComp: FC<any> | undefined = mod[entry.formName] || mod.default;
      if (!FormComp) return;
      const t = translate;
      addPane({
        label: `${t(entry.formName) || endpoint}`,
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
      if (e.key === "ArrowDown") {
        // Стрелка вниз — активировать «Быстрый выбор» (inline dropdown)
        if (!disabled) {
          e.preventDefault();
          handleQuickSelect();
        }
      } else if (e.key === "Enter") {
        // Enter без дропдауна — перейти на следующее поле
        e.preventDefault();
        onEnterKey?.();
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
        // handleSelectItem уже инициирует onAfterSelect (фокус на следующее поле).
        handleSuggestionClick(suggestions[activeIndex]);
      } else {
        setIsDropdownOpen(false);
        // Подтверждение без выбора — перейти на следующее поле.
        onEnterKey?.();
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
    }
  }, [isDropdownOpen, suggestions, activeIndex, inputText, disabled, handleOpenModal, handleSuggestionClick, onEnterKey]);

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
    const acts: { type: LookupActionType; onClick: () => void }[] = [];
    const allowed = visibleActions; // undefined = показывать все
    const show = (t: LookupActionType) => !allowed || allowed.includes(t);

    // В table-варианте кнопка «Очистить» избыточна: ячейка таблицы и так
    // редактируется поверх существующего значения, отдельная кнопка только
    // загромождает узкую колонку. Открытие/Быстрый выбор/Список оставляем.
    if (show("clear") && !isTable && (value || inputText)) {
      acts.push({ type: "clear", onClick: handleClear });
    }
    if (show("open") && value && getByEndpoint(endpoint)) {
      acts.push({ type: "open", onClick: handleOpenItemForm });
    }
    if (show("quickselect")) {
      acts.push({ type: "quickselect", onClick: handleQuickSelect });
    }
    if (show("list")) {
      acts.push({ type: "list", onClick: handleOpenModal });
    }
    return acts;
  }, [disabled, visibleActions, isTable, value, inputText, endpoint, handleClear, handleOpenItemForm, handleQuickSelect, handleOpenModal]);

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
          width: width ?? "100%",
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

        <div className={`${styles.FieldInputWrapper} ${disabled ? styles.FieldDisabled : ""}`}>
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
            className={styles.FieldString}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? "Введите для поиска..."}
            style={{
              cursor: disabled ? "default" : "text",
              // ...(fieldActions.length > 0 && {
              //   paddingRight: `${fieldActions.length * 32 + 8}px`,
              // }),
            }}
          />

          {fieldActions.length > 0 && (
            <div className={styles.FieldActions}>
              {fieldActions.map((action) => {
                const meta = FIELD_ACTION_META[action.type];
                return (
                  <FieldActionButton
                    key={action.type}
                    icon={meta.icon}
                    label={meta.label}
                    onClick={action.onClick}
                  />
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
