import { FC, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Field.module.scss";
import { fetchList } from "src/services/offlineDataService";
import { asText } from "src/utils/asText";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import {
  LOOKUP_CREATE_TOKEN_KEY,
  newLookupCreateToken,
  subscribeLookupCreated,
} from "src/utils/lookupCreateBus";
import { useDebounceValue } from "src/hooks/useDebounceValue";
import { useCellFieldState } from "src/hooks/useDirtyHighlight";
import { useFormRequiredScope } from "src/hooks/useFormRequired";
import { useAccessPermission } from "src/hooks/useAccessPermission";
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

/**
 * Дополнительное действие поля, задаваемое СНАРУЖИ (в отличие от встроенных
 * clear/open/quickselect/list, которые поле собирает само).
 *
 * Нужно, чтобы доменные действия не протекали в универсальный LookupField:
 * напр. «Перезаполнить по основанию» знает про документы-основания, а поле —
 * не должно. Владелец действия (BasisDocumentField) описывает его целиком.
 */
export interface LookupExtraAction {
  /** Стабильный ключ для React. */
  id: string;
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** display:none — место в ряду не занимает (как у встроенных действий). */
  hidden?: boolean;
  loading?: boolean;
  tone?: "warn";
}

/** Элемент справочника из произвольного эндпоинта: известные поля через
 *  индекс-сигнатуру как unknown (компилятор заставляет сузить перед использованием). */
export type LookupItem = Record<string, unknown>;

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
  onSelect: (uuid: string, displayValue: string, item: LookupItem) => void;
  /** Колбэк при очистке */
  onClear?: () => void;
  /** Endpoint API, напр. "organizations", "counterparties" */
  endpoint: string;
  /** Поле для отображения (по умолчанию "name") */
  displayField?: string;
  /** Дополнительные колонки (совместимость, не используется в новой версии) */
  columns?: { key: string; label: string }[];
  /** Кастомная функция для формирования текста подсказки в LookupDropdown */
  getSuggestionLabel?: (item: LookupItem) => string;
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
  listComponent?: FC<Record<string, unknown>>;
  /** Вариант отображения: default (форма) или table (внутри ячейки таблицы) */
  variant?: FieldVariant;
  /** Поля для отображения справа в автокомплите (напр. ["bin"] → показывает "(123456789012)").
   *  Поддерживает вложенные ключи через точку: "brand.name".
   *  Если не указан — берётся из defaultSecondaryFieldsMap по endpoint. */
  secondaryFields?: string[];
  /** Дополнительные query-параметры для фильтрации (передаются в autocomplete и SelectPaneWrapper).
   *  Например: { organizationUuid: "abc-123" } → ?organizationUuid=abc-123 */
  extraParams?: Record<string, string>;
  /** Поля для ПРЕДЗАПОЛНЕНИЯ формы нового элемента при «Создать новый» (в отличие
   *  от extraParams — это НЕ фильтр запроса, а начальные значения формы). Несёт
   *  и uuid, и отображаемое имя, чтобы поле-лукап в новой форме показывало текст,
   *  а не пустоту. Мёржится ПОВЕРХ extraParams. Пример для нового документа:
   *  { organizationUuid, organizationName, counterpartyUuid, counterpartyName }. */
  createDefaults?: Record<string, unknown>;
  /** Какие кнопки показывать. По умолчанию — все доступные.
   *  Пример: ["quickselect"] — только кнопка быстрого выбора. */
  visibleActions?: LookupActionType[];
  /** Доп. действия справа от встроенных (см. LookupExtraAction). */
  extraActions?: LookupExtraAction[];
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

// ── Ленивая загрузка Form-компонента по endpoint (через единый реестр) ──
import { getByEndpoint } from "src/registry/modelRegistry";
import { defaultSecondaryFieldsMap, ENDPOINT_ACCESS_MODEL, matchesAllWords } from "./lookupHelpers";

// endpoint → имя модели прав (AccessPermission.modelName) для гейтинга кнопки
// «Создать»: показываем её только если у пользователя есть право на запись
// (создание) этого справочника. Неизвестный endpoint → права не подтверждены →
// кнопка скрыта (для не-суперадмина).
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
  extraActions,
  secondaryFields,
  extraParams,
  createDefaults,
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
  // Заданная ширина ФИКСИРУЕТ поле (flex: 0 0 auto — не растягивать и не сжимать);
  // без width поле тянется по контейнеру (.FieldWrapper flex: 1 1 auto).
  const wrapperStyle = (width || maxWidth || minWidth)
    ? { ...(width ? { width, flex: '0 0 auto' } : {}), ...(maxWidth ? { maxWidth } : {}), ...(minWidth ? { minWidth } : {}) }
    : undefined;

  // ── Autocomplete state ──────────────────────────────────────────────────
  const [inputText, setInputText] = useState(displayValue || "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Дропдаун открыт ЯВНЫМ действием «Быстрый выбор» — только тогда показываем
  // область «Создать» при пустом списке (иначе — только при вводе текста).
  const [qsOpened, setQsOpened] = useState(false);
  useEffect(() => { if (!isDropdownOpen) setQsOpened(false); }, [isDropdownOpen]);
  const [suggestions, setSuggestions] = useState<LookupItem[]>([]);
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
  // Список рендерится порталом в body с position:fixed, поэтому координаты
  // считаем сами. Три вещи, без которых он «съезжает» с ячейки:
  //   • у .LookupDropdown нет box-sizing:border-box (глобального ресета в проекте
  //     нет), поэтому ширину задаём с учётом padding+border — иначе список шире
  //     ячейки на 8px и правым краем вылезает из колонки;
  //   • у крайних правых/нижних колонок список уезжал за окно — прижимаем к краю
  //     и раскрываем вверх, если снизу не помещается;
  //   • измеряем в useLayoutEffect, до отрисовки, иначе первый кадр — со старыми
  //     координатами.
  type DropdownPos = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);

  useLayoutEffect(() => {
    if (!isTable || !isDropdownOpen || !wrapperRef.current) {
      setDropdownPos(null);
      return;
    }
    const el = wrapperRef.current;
    const updatePos = () => {
      const rect = el.getBoundingClientRect();
      const GAP = 3;      // тот же зазор, что у нетабличного варианта (top: calc(100% + 3px))
      const EDGE = 6;     // отступ от края окна
      const MIN_W = 240;  // в узкой колонке список по ширине ячейки нечитаем
      const MAX_H = 280;  // как max-height в .LookupDropdown

      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const width = Math.min(Math.max(rect.width, MIN_W), vw - EDGE * 2);
      const left = Math.max(EDGE, Math.min(rect.left, vw - width - EDGE));

      const below = vh - rect.bottom - GAP - EDGE;
      const above = rect.top - GAP - EDGE;
      // Вверх раскрываем, только если снизу тесно И сверху заметно просторнее.
      const openUp = below < Math.min(MAX_H, 140) && above > below;

      setDropdownPos(openUp
        ? { left, width, maxHeight: Math.min(MAX_H, above), bottom: vh - rect.top + GAP }
        : { left, width, maxHeight: Math.min(MAX_H, below), top: rect.bottom + GAP });
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
      fetchList<LookupItem>(endpoint, undefined, { limit: 200, ...extraParams })
        .then((result) => {
          if (cancelled) return;
          const all = result.items;
          const filtered = all.filter((item) => {
            const label = getSuggestionLabel
              ? getSuggestionLabel(item)
              : asText(item[displayField]);
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
      fetchList<LookupItem>(endpoint, undefined, { search: searchText, limit: 10, ...extraParams })
        .then((result) => {
          if (cancelled) return;
          const items = result.items;
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
      data: { endpoint, listComponent, extraParams } as Partial<TDataItem>,
      onSelectResult: (item: LookupItem) => {
        const uuid = item.uuid as string;
        const display = getSuggestionLabel
          ? getSuggestionLabel(item)
          : asText(item[displayField] ?? item.value ?? item.name ?? uuid);
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
    fetchList<LookupItem>(endpoint, undefined, { limit: 200, ...extraParams })
      .then((result) => {
        const items = result.items;
        setSuggestions(items);
        setIsDropdownOpen(true);
        // Первый элемент сразу выделен — Up/Down навигация + Enter работают.
        setActiveIndex(items.length > 0 ? 0 : -1);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setIsLoading(false));
  }, [disabled, endpoint, extraParams]);

  const handleSelectItem = useCallback((item: LookupItem) => {
    const uuid = item.uuid as string;
    const display = getSuggestionLabel
      ? getSuggestionLabel(item)
      : asText(item[displayField] ?? item.value ?? item.name ?? uuid);
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
    // disabled НЕ мешает: открыть карточку связанного объекта — это чтение, а не
    // правка. Иначе в проведённом документе (все поля disabled) нельзя было бы
    // посмотреть контрагента, а в журнале событий 1С — организацию/пользователя.
    if (!value) return;
    const entry = getByEndpoint(endpoint);
    if (!entry) return;
    entry.module().then((mod) => {
      const forms = mod as Record<string, FC<Partial<TPane>> | undefined>;
      const FormComp: FC<Partial<TPane>> | undefined = forms[entry.formName] || forms.default;
      if (!FormComp) return;
      const t = translate;
      addPane({
        label: t(entry.formName) || entry.label || endpoint,
        component: FormComp,
        data: { uuid: value } as Partial<TDataItem>,
      });
    }).catch(() => { /* тихо игнорируем ошибку загрузки */ });
  }, [value, endpoint, addPane]);

  // ── Создать новый элемент справочника (открывает форму создания) ─────────
  // Токен ждущего создания: по нему созданный объект вернётся ИМЕННО в это поле
  // (write-back). Панель-владельца активирует сам requestClose по openerPaneId.
  const [pendingCreateToken, setPendingCreateToken] = useState<string | null>(null);

  const handleCreateItem = useCallback(() => {
    if (disabled) return;
    const entry = getByEndpoint(endpoint);
    if (!entry) return;
    entry.module().then((mod) => {
      const forms = mod as Record<string, FC<Partial<TPane>> | undefined>;
      const FormComp: FC<Partial<TPane>> | undefined = forms[entry.formName] || forms.default;
      if (!FormComp) return;
      const token = newLookupCreateToken();
      setPendingCreateToken(token);
      addPane({
        label: translate(entry.formName) || entry.label || endpoint,
        component: FormComp,
        // Новая запись, НО с контекстом родителя: extraParams несут ownerType/
        // ownerUuid (или иной scope), а createDefaults — явные начальные значения
        // (uuid+имя) для предзаполнения. Раньше здесь был пустой {} и контекст
        // терялся. createDefaults мёржится ПОВЕРХ extraParams (приоритет предзаполнению).
        // [LOOKUP_CREATE_TOKEN_KEY] — обратный канал: форма вернёт созданный объект сюда.
        data: {
          ...(extraParams ?? {}),
          ...(createDefaults ?? {}),
          [LOOKUP_CREATE_TOKEN_KEY]: token,
        } as Partial<TDataItem>,
      });
      setIsDropdownOpen(false);
    }).catch(() => { /* тихо игнорируем ошибку загрузки */ });
  }, [disabled, endpoint, addPane, extraParams, createDefaults]);

  // Ждём созданный объект по токену и подставляем его в поле (тем же путём, что и
  // обычный выбор — handleSelectItem считает отображаемое значение и зовёт onSelect).
  useEffect(() => {
    if (!pendingCreateToken) return;
    const unsubscribe = subscribeLookupCreated(pendingCreateToken, (detail) => {
      setPendingCreateToken(null);
      // Страховка: эндпоинт созданной записи должен совпадать с полем.
      if (detail.endpoint && detail.endpoint !== endpoint) return;
      const item = detail.item ?? {};
      handleSelectItem({ ...item, uuid: detail.uuid });
    });
    return unsubscribe;
  }, [pendingCreateToken, endpoint, handleSelectItem]);

  // Есть ли форма создания для этого справочника (реестр моделей).
  // Право на создание нового элемента справочника (гейт кнопки «Создать»).
  const { canWrite: canCreateByRight } = useAccessPermission(ENDPOINT_ACCESS_MODEL[endpoint] ?? "");
  const canCreate = allowCreate && !disabled && !!getByEndpoint(endpoint) && canCreateByRight;

  // Выбор элемента из dropdown
  const handleSuggestionClick = useCallback((item: LookupItem) => {
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
  }, [isDropdownOpen, suggestions, activeIndex, inputText, displayValue, isLoading, debouncedText, disabled, handleSuggestionClick, handleQuickSelect, onEnterKey]);

  // Разрешение отложенного Enter: как только поиск завершился — выбираем точное
  // совпадение по тексту (иначе первое), либо переходим дальше, если совпадений нет.
  useEffect(() => {
    if (!pendingEnterRef.current || isLoading) return;
    pendingEnterRef.current = false;
    if (suggestions.length > 0) {
      const norm = inputText.trim().toLowerCase();
      const exact = suggestions.find((s) => {
        const label = getSuggestionLabel ? getSuggestionLabel(s) : asText(s[displayField]);
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
    const acts: { type: LookupActionType; onClick: () => void; disabled?: boolean; hidden?: boolean }[] = [];
    const allowed = visibleActions; // undefined = показывать все
    const show = (t: LookupActionType) => !allowed || allowed.includes(t);
    const hasValue = !!(value || inputText);

    // Ключевой принцип против «прыжков» разметки: НАБОР кнопок в DOM постоянен —
    // ни disabled (сохранение/проведение), ни очистка значения не убирают кнопки, а
    // лишь ДЕЛАЮТ их недоступными (disabled) или НЕВИДИМЫМИ (hidden → visibility:hidden,
    // место сохраняется). Иначе ширина блока действий менялась и поле дёргалось.
    // «Открыть» и «Очистить» имеют смысл только при значении — при пустом их скрываем,
    // но место резервируем. В table-варианте «Очистить» не показываем совсем (ячейка
    // редактируется поверх) — это константа поля, ширину не меняет.
    if (show("quickselect")) {
      acts.push({ type: "quickselect", onClick: handleQuickSelect, disabled });
    }
    if (show("open") && getByEndpoint(endpoint)) {
      acts.push({ type: "open", onClick: handleOpenItemForm, hidden: !value }); // чтение — доступно при значении
    }
    if (show("list")) {
      acts.push({ type: "list", onClick: handleOpenModal, disabled });
    }
    if (show("clear") && !isTable) {
      acts.push({ type: "clear", onClick: handleClear, disabled, hidden: !hasValue });
    }
    // Скрытые (display:none, места не занимают) — в хвост: React сохраняет
    // стабильные позиции видимых кнопок при переключениях. Ширина поля от кнопок
    // не зависит (базис 0 / фиксированная width — см. Field.module.scss).
    acts.sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden));
    return acts;
  }, [disabled, visibleActions, isTable, value, inputText, endpoint, handleClear, handleOpenItemForm, handleQuickSelect, handleOpenModal]);

  // Получить отображаемое поле элемента
  const getItemDisplay = useCallback((item: LookupItem) => {
    if (getSuggestionLabel) {
      return getSuggestionLabel(item);
    }
    return asText(item[displayField] ?? item.value ?? item.name ?? item.uuid);
  }, [displayField, getSuggestionLabel]);

  // Вспомогательная: получить значение по ключу с поддержкой вложенности ("brand.name")
  const getNestedValue = useCallback((item: LookupItem, key: string): string => {
    const parts = key.split(".");
    let val: unknown = item;
    for (const p of parts) {
      if (val == null || typeof val !== "object") return "";
      val = (val as Record<string, unknown>)[p];
    }
    return val != null && typeof val !== "object" ? asText(val) : "";
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
  const getMatchedBarcode = useCallback((item: LookupItem) => {
    const q = (searchTransform ? searchTransform(debouncedText) : debouncedText).trim().toLowerCase();
    if (!q) return "";
    const candidates: string[] = [];
    if (item.barcode) candidates.push(asText(item.barcode));
    if (Array.isArray(item.barcodes)) {
      for (const b of item.barcodes) {
        const code = typeof b === "string" ? b : (b as { barcode?: unknown })?.barcode;
        if (code) candidates.push(asText(code));
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
  const getItemSecondary = useCallback((item: LookupItem) => {
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

          {(fieldActions.length > 0 || (extraActions?.length ?? 0) > 0) && (
            <div className={styles.FieldActions}>
              {fieldActions.map((action) => {
                const meta = FIELD_ACTION_META[action.type];
                // hidden-класс — ПРЯМО на кнопке, без span-обёртки: спаны в ячейках
                // таблицы получают padding: 0 6px (Table.module «span,code») и кнопки
                // расползались. Кнопка (button) под то правило не подпадает.
                return (
                  <FieldActionButton
                    key={action.type}
                    icon={meta.icon}
                    label={meta.label}
                    onClick={action.onClick}
                    disabled={action.disabled || action.hidden}
                    className={action.hidden ? styles.FieldActionHidden : undefined}
                    aria-hidden={action.hidden || undefined}
                  />
                );
              })}
              {/* Внешние действия — всегда в хвосте ряда: позиции встроенных кнопок
                  не должны зависеть от того, передал ли владелец доп. действия. */}
              {extraActions?.map((action) => (
                <FieldActionButton
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  onClick={action.onClick}
                  disabled={action.disabled || action.hidden}
                  loading={action.loading}
                  tone={action.tone}
                  className={action.hidden ? styles.FieldActionHidden : undefined}
                  aria-hidden={action.hidden || undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Autocomplete dropdown ───────────────────────────────────── */}
        {isDropdownOpen && (suggestions.length > 0 || isLoading || (canCreate && (qsOpened || (inputText.trim() !== "" && inputText !== displayValue)))) && !isTable && (
          <div className={styles.LookupDropdown} ref={dropdownRef}>
            {isLoading && suggestions.length === 0 && (
              <div className={styles.LookupDropdownLoading}>{translate("searching")}</div>
            )}
            {suggestions.map((item, idx) => {
              const primary = getItemDisplay(item);
              const secondary = getItemSecondary(item);
              return (
                <div
                  key={(item.uuid as string | undefined) ?? idx}
                  className={`${styles.LookupDropdownItem} ${idx === activeIndex ? styles.LookupDropdownItemActive : ""}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return; // только ЛКМ (ПКМ/СКМ не выбирают)
                    e.preventDefault(); // Не дать blur сработать раньше click
                    handleSuggestionClick(item);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span className={styles.LookupDropdownPrimary}>{postedIndicator && typeof item.posted === "boolean" && <span aria-hidden title={item.posted ? translate("posted") : translate("draft")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", verticalAlign: "middle", marginRight: 6, background: item.posted ? "var(--c-green-30, #1a7f37)" : "var(--c-cyan-84a, #cbd5e1)" }} />}{primary}</span>
                  {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
                </div>
              );
            })}
            {!isLoading && suggestions.length === 0 && (
              <div className={styles.LookupDropdownLoading}>{translate("nothingFound")}</div>
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
            left: dropdownPos.left,
            // right в .LookupDropdown = 0 (для нетабличного варианта); при заданной
            // ширине он игнорируется, но гасим явно, чтобы не зависеть от порядка правил.
            right: "auto",
            width: dropdownPos.width,
            maxHeight: dropdownPos.maxHeight,
            ...(dropdownPos.top !== undefined ? { top: dropdownPos.top } : { bottom: dropdownPos.bottom }),
            zIndex: 9999,
          }}
        >
          {isLoading && suggestions.length === 0 && (
            <div className={styles.LookupDropdownLoading}>{translate("searching")}</div>
          )}
          {suggestions.map((item, idx) => {
            const primary = getItemDisplay(item);
            const secondary = getItemSecondary(item);
            return (
              <div
                key={(item.uuid as string | undefined) ?? idx}
                className={`${styles.LookupDropdownItem} ${idx === activeIndex ? styles.LookupDropdownItemActive : ""}`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return; // только ЛКМ (ПКМ/СКМ не выбирают)
                  e.preventDefault();
                  handleSuggestionClick(item);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className={styles.LookupDropdownPrimary}>{postedIndicator && typeof item.posted === "boolean" && <span aria-hidden title={item.posted ? translate("posted") : translate("draft")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", verticalAlign: "middle", marginRight: 6, background: item.posted ? "var(--c-green-30, #1a7f37)" : "var(--c-cyan-84a, #cbd5e1)" }} />}{primary}</span>
                {secondary && <span className={styles.LookupDropdownSecondary}>{secondary}</span>}
              </div>
            );
          })}
          {!isLoading && suggestions.length === 0 && (
            <div className={styles.LookupDropdownLoading}>{translate("nothingFound")}</div>
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
