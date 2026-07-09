import { FC, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Field.module.scss";
import { fetchList } from "src/services/offlineDataService";
import { useDebounceValue } from "src/hooks/useDebounceValue";
import { useCellFieldState } from "src/hooks/useDirtyHighlight";
import { useFormRequiredScope } from "src/hooks/useFormRequired";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAppContext } from "src/app/context";
import SelectPaneWrapper from "./SelectPaneWrapper";
import { setPendingHighlight } from "src/utils/listHighlight";
import FieldActionButton from "./FieldActionButton";
import { Icon } from "src/components/IconButton/icons";
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
  /** Префикс-адорнмент внутри поля (слева от input). Напр. индикатор сопоставления
   *  номенклатуры ✓/＋ — позволяет не оборачивать поле во внешний div в ячейке. */
  prefix?: React.ReactNode;
  /** Имя поля для id/name */
  name: string;
  /** Явный id для input (для ассоциации с внешним label) */
  id?: string;
  /** Текущий UUID (значение для хранения) */
  value?: string;
  /** Отображаемое значение (name, value и т.д.) */
  displayValue?: string;
  /** Колбэк при выборе элемента: (uuid, displayValue, item) */
  onSelect: (uuid: string, displayValue: string, item: Record<string, any>) => void;
  /** Колбэк при очистке */
  onClear?: () => void;
  /** Endpoint API, напр. "organizations", "counterparties" */
  endpoint: string;
  /** Поле для отображения (по умолчанию "name") */
  displayField?: string;
  /** Дополнительные колонки (совместимость, не используется в новой версии) */
  columns?: { key: string; label: string }[];
  /** Кастомная функция для формирования текста подсказки в LookupDropdown */
  getSuggestionLabel?: (item: Record<string, any>) => string;
  /** Автофокус поля при монтировании (например единственное поле ввода в терминале). */
  autoFocus?: boolean;
  /** Показывать индикатор проведения (цветная точка) для элементов-документов
   *  с булевым `posted`. По умолчанию выкл. — включается там, где это уместно
   *  (поле «Основание»). Если у элемента нет `posted` — точка не рисуется. */
  postedIndicator?: boolean;
  /** Преобразует введённый пользователем текст перед отправкой на бэкенд (search-параметр).
   *  Полезно когда displayValue имеет составной формат (напр. "Тип: ID 5 - дата"),
   *  а бэкенд ожидает только числовой id или другой простой ключ. */
  searchTransform?: (input: string) => string;
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
   *  Поддерживает вложенные ключи через точку: "brand.name".
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
  /** Обязательное поле — показывает * в подписи и подсвечивает когда не выбрано */
  required?: boolean;
  /** Ошибка валидации — подсвечивает поле красным */
  error?: boolean;
  /** Разрешить свободный ввод текста без выбора записи (напр. новая номенклатура
   *  при импорте). Введённый текст НЕ теряется при потере фокуса — он отдаётся
   *  через onTextChange, а value (uuid) остаётся пустым до выбора из списка. */
  allowFreeText?: boolean;
  /** Разрешить кнопку «Создать» в дропдауне (по умолчанию true). false — для
   *  справочников только для чтения (напр. классификаторы РК). */
  allowCreate?: boolean;
  /** Колбэк свободного ввода (только при allowFreeText): (text) => void. */
  onTextChange?: (text: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// МАППИНГ endpoint → *List компонент — перенесён в SelectPaneWrapper.tsx
// ═══════════════════════════════════════════════════════════════════════════

// ── Поля для отображения в выпадающем списке автокомплита ──────────────
// Ключ — endpoint, значение — массив полей, которые показываются
// справа в скобках рядом с основным displayField.
// Поддерживает вложенные ключи через точку: "brand.name"
const defaultSecondaryFieldsMap: Record<string, string[]> = {
  organizations: ["bin"],
  counterparties: ["bin", "iin"],
  products: ["sku", "brand.name"],
  employees: ["iin", "position"],
  users: ["employee.fullName"],
  // contracts: ["documentNumber"],
  bankaccounts: ["iban"],
  currencies: ["code", "symbol"],
  warehouses: ["code"],
  brands: [],
};

// ── Ленивая загрузка Form-компонента по endpoint (через единый реестр) ──
import { getByEndpoint } from "src/registry/modelRegistry";

// endpoint → имя модели прав (UserAccessRight.modelName) для гейтинга кнопки
// «Создать»: показываем её только если у пользователя есть право на запись
// (создание) этого справочника. Неизвестный endpoint → права не подтверждены →
// кнопка скрыта (для не-суперадмина).
const ENDPOINT_ACCESS_MODEL: Record<string, string> = {
  organizations: "Organization",
  counterparties: "Counterparty",
  contracts: "Contract",
  products: "Product",
  employees: "Employee",
  warehouses: "Warehouse",
  cashboxes: "Cashbox",
  bankaccounts: "BankAccount",
  contactpersons: "ContactPerson",
  contacts: "Contact",
  taxes: "Tax",
  users: "User",
  "price-types": "PriceType",
  "unit-of-measures": "UnitOfMeasure",
  brands: "Brand",
  currencies: "Currency",
};

// Нормализация для клиентского поиска по метке: нижний регистр + ё→е.
const normForSearch = (s: string): string => s.toLowerCase().replace(/ё/g, "е");
// Слово-ориентированный матч: ВСЕ слова запроса должны входить в метку (AND),
// порядок и пунктуация между ними не важны. Тогда «Счёт оплату 133», «133 08.03»,
// «оплата 133» одинаково находят «Счёт на оплату: №133 - 08.03.2026».
const matchesAllWords = (label: string, query: string): boolean => {
  const hay = normForSearch(label);
  const words = normForSearch(query).split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
};

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP FIELD — поле с кнопками "выбор" и "очистить"
// Форма выбора открывается как отдельная PaneItem-вкладка через SelectPaneWrapper
// ═══════════════════════════════════════════════════════════════════════════

const LookupField: FC<LookupFieldProps> = ({
  label,
  prefix,
  name,
  id,
  value = "",
  displayValue = "",
  onSelect,
  onClear,
  endpoint,
  displayField = "name",
  columns: _columns,
  getSuggestionLabel,
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
  required = false,
  error = false,
  searchTransform,
  allowFreeText = false,
  allowCreate = true,
  onTextChange,
  autoFocus = false,
  postedIndicator = false,
}) => {
  // Подавляем неиспользуемые переменные совместимости
  void _columns;

  const { windows: { addPane } } = useAppContext();

  const cellState = useCellFieldState();
  const formRequired = useFormRequiredScope();
  const isTable = variant === 'table';
  const generatedId = useId();
  const uid = id ?? generatedId;
  const tail = name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : name;
  const isEmpty = !value;
  const isFormRequired = !isTable && formRequired.requiredKeys.has(tail);
  const effectiveRequired = required || !!cellState.required || isFormRequired;
  const effectiveError = error || !!cellState.error;

  const wrapperClass = [
    isTable ? `${styles.FieldWrapper} ${styles.tableVariant}` : styles.FieldWrapper,
    !effectiveError && effectiveRequired && isEmpty ? styles.FieldRequired : '',
    effectiveError ? styles.FieldError : '',
  ].filter(Boolean).join(' ');

  // Инлайн-стиль только для ЯВНО переданных размеров; дефолты (width:100%) — в CSS
  // (.FieldWrapper / .tableVariant), чтобы в табличных ячейках не было лишних inline-styles.
  const wrapperStyle = (width || maxWidth || minWidth)
    ? { ...(width ? { width } : {}), ...(maxWidth ? { maxWidth } : {}), ...(minWidth ? { minWidth } : {}) }
    : undefined;

  // ── Autocomplete state ──────────────────────────────────────────────────
  const [inputText, setInputText] = useState(displayValue || "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Дропдаун открыт ЯВНЫМ действием «Быстрый выбор» — только тогда показываем
  // область «Создать» при пустом списке (иначе — только при вводе текста).
  const [qsOpened, setQsOpened] = useState(false);
  useEffect(() => { if (!isDropdownOpen) setQsOpened(false); }, [isDropdownOpen]);
  const [suggestions, setSuggestions] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Enter нажат раньше, чем поиск вернул подсказки (быстрая вставка наименования).
  // Откладываем переход фокуса до результата — затем выбираем точное совпадение.
  const pendingEnterRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedText = useDebounceValue(inputText, 300);

  // ── Portal dropdown position (for table variant) ──────────────────────
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!isTable || !isDropdownOpen || !wrapperRef.current) {
      setDropdownPos(null);
      return;
    }
    const el = wrapperRef.current;
    const updatePos = () => {
      const rect = el.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    updatePos();
    // Обновляем при скролле / ресайзе окна и при изменении ширины самого поля
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updatePos) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
      ro?.disconnect();
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
    const searchText = searchTransform ? searchTransform(debouncedText) : debouncedText;
    let cancelled = false;
    setIsLoading(true);

    if (!searchText && searchTransform) {
      // Transform вернул "" — загружаем все записи и фильтруем на клиенте
      // по getSuggestionLabel (или displayField), чтобы поиск по лейблу работал.
      fetchList(endpoint, undefined, { limit: 200, ...extraParams })
        .then((result) => {
          if (cancelled) return;
          const all = result.items as any[];
          const filtered = all.filter((item) => {
            const label = getSuggestionLabel
              ? getSuggestionLabel(item)
              : String(item[displayField] ?? "");
            // Слово-ориентированный матч по видимой метке (см. matchesAllWords).
            return matchesAllWords(label, debouncedText);
          });
          setSuggestions(filtered);
          setIsDropdownOpen(true);
          setActiveIndex(filtered.length > 0 ? 0 : -1);
        })
        .catch(() => { if (!cancelled) setSuggestions([]); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    } else if (searchText) {
      fetchList(endpoint, undefined, { search: searchText, limit: 10, ...extraParams })
        .then((result) => {
          if (cancelled) return;
          const items = result.items as any[];
          setSuggestions(items);
          setIsDropdownOpen(true);
          setActiveIndex(items.length > 0 ? 0 : -1);
        })
        .catch(() => { if (!cancelled) setSuggestions([]); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    } else {
      setSuggestions([]);
      setIsLoading(false);
    }

    return () => { cancelled = true; };
  }, [debouncedText, endpoint, displayValue, searchTransform, getSuggestionLabel, displayField]);

  // Click-outside: закрытие dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current && !wrapperRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))) {
        setIsDropdownOpen(false);
        // Если значение не выбрано — восстановить displayValue
        // (в режиме allowFreeText сохраняем введённый текст как есть).
        if (allowFreeText) {
          // оставляем текущий inputText
        } else if (!value) {
          setInputText("");
        } else {
          setInputText(displayValue || "");
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, displayValue, allowFreeText]);

  const handleOpenModal = useCallback(() => {
    if (disabled) return;
    // «Выбор из списка»: подсветить/активировать текущее выбранное значение в списке
    // (activeRow), как это делает «Показать в списке».
    if (value) setPendingHighlight(endpoint, value);
    addPane({
      component: SelectPaneWrapper,
      label: `${translate("selectTitle")}: ${(typeof label === "string" && label.trim()) ? translate(label) : (getByEndpoint(endpoint)?.label ?? endpoint)}`,
      isSelector: true,
      data: { endpoint, listComponent, extraParams } as any,
      onSelectResult: (item: Record<string, any>) => {
        const uuid = item.uuid as string;
        const display = getSuggestionLabel
          ? getSuggestionLabel(item)
          : String(item[displayField] ?? item.value ?? item.name ?? uuid);
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
  }, [disabled, addPane, label, endpoint, listComponent, displayField, getSuggestionLabel, onSelect, extraParams, onAfterSelect, value]);

  // ── Быстрый выбор — загружает все записи и открывает inline dropdown ──
  const handleQuickSelect = useCallback(() => {
    if (disabled) return;
    // Гарантируем, что фокус останется на input — иначе клавиши Up/Down
    // после клика по кнопке уйдут в родительский контейнер (напр. SubTable
    // → перемещение activeRow). preventDefault в onMouseDown FieldActionButton
    // удерживает фокус, но если кнопка нажата с клавиатуры (Enter/Space) или
    // input ещё не был сфокусирован — явно переводим фокус сюда.
    inputRef.current?.focus();
    setQsOpened(true);
    setIsLoading(true);
    fetchList(endpoint, undefined, { limit: 200, ...extraParams })
      .then((result) => {
        const items = result.items as any[];
        setSuggestions(items);
        setIsDropdownOpen(true);
        // Первый элемент сразу выделен — Up/Down навигация + Enter работают.
        setActiveIndex(items.length > 0 ? 0 : -1);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setIsLoading(false));
  }, [disabled, endpoint, extraParams]);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    const uuid = item.uuid as string;
    const display = getSuggestionLabel
      ? getSuggestionLabel(item)
      : String(item[displayField] ?? item.value ?? item.name ?? uuid);
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
  }, [onSelect, displayField, getSuggestionLabel, onAfterSelect]);

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
        label: t(entry.formName) || entry.label || endpoint,
        component: FormComp,
        data: { uuid: value } as any,
      });
    }).catch(() => { /* тихо игнорируем ошибку загрузки */ });
  }, [value, disabled, endpoint, displayValue, addPane]);

  // ── Создать новый элемент справочника (открывает форму создания) ─────────
  const handleCreateItem = useCallback(() => {
    if (disabled) return;
    const entry = getByEndpoint(endpoint);
    if (!entry) return;
    entry.module().then((mod) => {
      const FormComp: FC<any> | undefined = mod[entry.formName] || mod.default;
      if (!FormComp) return;
      addPane({
        label: translate(entry.formName) || entry.label || endpoint,
        component: FormComp,
        data: {} as any, // новая запись
      });
      setIsDropdownOpen(false);
    }).catch(() => { /* тихо игнорируем ошибку загрузки */ });
  }, [disabled, endpoint, addPane]);

  // Есть ли форма создания для этого справочника (реестр моделей).
  // Право на создание нового элемента справочника (гейт кнопки «Создать»).
  const { canWrite: canCreateByRight } = useUserAccessRight(ENDPOINT_ACCESS_MODEL[endpoint] ?? "");
  const canCreate = allowCreate && !disabled && !!getByEndpoint(endpoint) && canCreateByRight;
  // Название справочника для кнопки «Создать» (не введённый текст — он не
  // подставляется в форму создания, поэтому показывать его в label некорректно).
  const createEntityLabel = (typeof label === "string" && label.trim())
    ? translate(label)
    : (getByEndpoint(endpoint)?.label ?? "");

  // Выбор элемента из dropdown
  const handleSuggestionClick = useCallback((item: Record<string, any>) => {
    handleSelectItem(item);
  }, [handleSelectItem]);

  // Обработка ввода текста
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQsOpened(false); // ввод текста — это уже не «быстрый выбор»
    setInputText(val);
    // Если пользователь стирает текст — очистить выбранное значение
    if (!val && value) {
      onSelect("", "", {});
      onClear?.();
    }
    // Свободный ввод: отдаём текст наружу (не теряем при потере фокуса).
    // Любое ручное редактирование сбрасывает ранее выбранный uuid.
    if (allowFreeText) {
      if (value) { onSelect("", val, {}); onClear?.(); }
      onTextChange?.(val);
    }
    if (val) {
      setIsDropdownOpen(true);
    } else {
      setIsDropdownOpen(false);
      setSuggestions([]);
    }
  }, [value, onSelect, onClear, allowFreeText, onTextChange]);

  // Навигация клавишами в dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || suggestions.length === 0) {
      if (e.key === "ArrowDown") {
        // Стрелка вниз — активировать «Быстрый выбор» (inline dropdown)
        if (!disabled) {
          e.preventDefault();
          e.stopPropagation();
          handleQuickSelect();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        // Если поиск ещё не завершён для текущего текста (debounce/запрос в полёте) —
        // НЕ уходим сразу, а ждём подсказки и выбираем совпадение (см. эффект ниже).
        const searchSettled = !isLoading && debouncedText === inputText;
        if (inputText.trim() !== "" && inputText !== displayValue && !searchSettled) {
          pendingEnterRef.current = true;
        } else {
          onEnterKey?.();
        }
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        // handleSelectItem уже инициирует onAfterSelect (фокус на следующее поле).
        handleSuggestionClick(suggestions[activeIndex]);
      } else {
        setIsDropdownOpen(false);
        // Подтверждение без выбора — перейти на следующее поле.
        onEnterKey?.();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsDropdownOpen(false);
    }
  }, [isDropdownOpen, suggestions, activeIndex, inputText, displayValue, isLoading, debouncedText, disabled, handleOpenModal, handleSuggestionClick, handleQuickSelect, onEnterKey]);

  // Разрешение отложенного Enter: как только поиск завершился — выбираем точное
  // совпадение по тексту (иначе первое), либо переходим дальше, если совпадений нет.
  useEffect(() => {
    if (!pendingEnterRef.current || isLoading) return;
    pendingEnterRef.current = false;
    if (suggestions.length > 0) {
      const norm = inputText.trim().toLowerCase();
      const exact = suggestions.find((s) => {
        const label = getSuggestionLabel ? getSuggestionLabel(s) : String(s[displayField] ?? "");
        return label.trim().toLowerCase() === norm;
      });
      handleSuggestionClick(exact ?? suggestions[0]);
    } else {
      onEnterKey?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, suggestions]);

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
    if (show("quickselect")) {
      acts.push({ type: "quickselect", onClick: handleQuickSelect });
    }
    if (show("open") && value && getByEndpoint(endpoint)) {
      acts.push({ type: "open", onClick: handleOpenItemForm });
    }
    if (show("list")) {
      acts.push({ type: "list", onClick: handleOpenModal });
    }
    if (show("clear") && !isTable && (value || inputText)) {
      acts.push({ type: "clear", onClick: handleClear });
    }
    return acts;
  }, [disabled, visibleActions, isTable, value, inputText, endpoint, handleClear, handleOpenItemForm, handleQuickSelect, handleOpenModal]);

  // Получить отображаемое поле элемента
  const getItemDisplay = useCallback((item: Record<string, any>) => {
    if (getSuggestionLabel) {
      return getSuggestionLabel(item);
    }
    return String(item[displayField] ?? item.value ?? item.name ?? item.uuid ?? "");
  }, [displayField, getSuggestionLabel]);

  // Вспомогательная: получить значение по ключу с поддержкой вложенности ("brand.name")
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

  // Штрих-код элемента, совпавший с введённым запросом (если искали по ШК).
  // Источники: скалярное поле `barcode` + связанные `barcodes: [{ barcode }]`.
  // Точное совпадение приоритетнее частичного. Для не-товаров вернёт "".
  const getMatchedBarcode = useCallback((item: Record<string, any>) => {
    const q = (searchTransform ? searchTransform(debouncedText) : debouncedText).trim().toLowerCase();
    if (!q) return "";
    const candidates: string[] = [];
    if (item.barcode) candidates.push(String(item.barcode));
    if (Array.isArray(item.barcodes)) {
      for (const b of item.barcodes) {
        const code = typeof b === "string" ? b : b?.barcode;
        if (code) candidates.push(String(code));
      }
    }
    if (candidates.length === 0) return "";
    const exact = candidates.find((c) => c.toLowerCase() === q);
    if (exact) return exact;
    return candidates.find((c) => c.toLowerCase().includes(q)) ?? "";
  }, [debouncedText, searchTransform]);

  // Получить вторичную строку для элемента автокомплита.
  // Формат: "ШК - sku - бренд" (через разделитель) — только непустые значения.
  // Совпавший штрих-код (если искали по ШК) показываем первым — рядом с названием.
  const getItemSecondary = useCallback((item: Record<string, any>) => {
    const parts: string[] = [];
    const barcode = getMatchedBarcode(item);
    if (barcode) parts.push(barcode);
    for (const field of resolvedSecondaryFields) {
      const v = getNestedValue(item, field);
      if (v) parts.push(v);
    }
    return parts.join(" - ");
  }, [resolvedSecondaryFields, getNestedValue, getMatchedBarcode]);

  return (
    <>
      <div
        className={wrapperClass}
        style={wrapperStyle}
        ref={wrapperRef}
      >
        {!isTable && label && (
          <label htmlFor={uid} className={styles.FieldLabel}>
            {typeof label === 'string' ? translate(label) : label}
            {effectiveRequired && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
          </label>
        )}

        <div className={[styles.FieldInputWrapper, disabled ? styles.FieldDisabled : ''].filter(Boolean).join(' ')}>
          {prefix != null && prefix !== false && <span className={styles.FieldPrefix}>{prefix}</span>}
          <input
            ref={inputRef}
            type="text"
            id={uid}
            name={name}
            value={inputText}
            autoFocus={autoFocus}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            // Combobox-паттерн: aria-expanded сигнализирует обёрткам (например,
            // SubTable handleContainerKeyDown), что у поля открыт собственный
            // dropdown и Up/Down/Enter нужно отдавать ему, а не использовать
            // для навигации по строкам таблицы.
            role="combobox"
            aria-expanded={isDropdownOpen}
            aria-autocomplete="list"
            onFocus={() => {
              // При фокусе — если есть текст и нет выбранного значения, открыть dropdown
              if (inputText && !value && suggestions.length > 0) {
                setIsDropdownOpen(true);
              }
            }}
            onBlur={(e) => {
              // Если фокус ушёл внутрь dropdown (например, на скроллбар) — не закрывать
              const next = e.relatedTarget as Node | null;
              if (next && dropdownRef.current && dropdownRef.current.contains(next)) {
                return;
              }
              setIsDropdownOpen(false);
            }}
            className={styles.FieldString}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? "Введите для поиска..."}
            style={{
              cursor: disabled ? "default" : "text",
              "paddingRight": 0
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
        {isDropdownOpen && (suggestions.length > 0 || isLoading || (canCreate && (qsOpened || (inputText.trim() !== "" && inputText !== displayValue)))) && !isTable && (
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
                    if (e.button !== 0) return; // только ЛКМ (ПКМ/СКМ не выбирают)
                    e.preventDefault(); // Не дать blur сработать раньше click
                    handleSuggestionClick(item);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span className={styles.LookupDropdownPrimary}>{postedIndicator && typeof item.posted === "boolean" && <span aria-hidden title={item.posted ? translate("posted") : translate("draft")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", verticalAlign: "middle", marginRight: 6, background: item.posted ? "#1a7f37" : "#cbd5e1" }} />}{primary}</span>
                  {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
                </div>
              );
            })}
            {!isLoading && suggestions.length === 0 && (
              <div className={styles.LookupDropdownLoading}>Ничего не найдено</div>
            )}
            {canCreate && (
              <div className={styles.LookupDropdownCreateWrapper}>
                <button type="button" className={styles.LookupDropdownCreate}
                  onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); handleCreateItem(); }}>
                  <Icon name="plus" width={16} height={16} />
                  {translate("createNew")} новый

                  {/* {createEntityLabel ? `: ${createEntityLabel}` : ""} */}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Portal dropdown for table variant ──────────────────────────── */}
      {isTable && isDropdownOpen && (suggestions.length > 0 || isLoading || (canCreate && (qsOpened || (inputText.trim() !== "" && inputText !== displayValue)))) && dropdownPos && createPortal(
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
                  if (e.button !== 0) return; // только ЛКМ (ПКМ/СКМ не выбирают)
                  e.preventDefault();
                  handleSuggestionClick(item);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className={styles.LookupDropdownPrimary}>{postedIndicator && typeof item.posted === "boolean" && <span aria-hidden title={item.posted ? translate("posted") : translate("draft")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", verticalAlign: "middle", marginRight: 6, background: item.posted ? "#1a7f37" : "#cbd5e1" }} />}{primary}</span>
                {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
              </div>
            );
          })}
          {!isLoading && suggestions.length === 0 && (
            <div className={styles.LookupDropdownLoading}>Ничего не найдено</div>
          )}
          {canCreate && (
            <div className={styles.LookupDropdownCreateWrapper}>
              <button type="button" className={styles.LookupDropdownCreate}
                onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); handleCreateItem(); }}>
                <Icon name="plus" width={16} height={16} />
                {translate("createNew")} новый

                {/* {createEntityLabel ? `: ${createEntityLabel}` : ""} */}
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}

    </>
  );
};

export default LookupField;
