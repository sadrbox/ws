import { FC, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./Field.module.scss";
import Modal from "../Modal";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LookupFieldProps {
  /** Заголовок поля */
  label: React.ReactNode;
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
}

// ═══════════════════════════════════════════════════════════════════════════
// МАППИНГ endpoint → *List компонент (ленивый импорт для избежания
// циклических зависимостей)
// ═══════════════════════════════════════════════════════════════════════════

const listComponentRegistry: Record<string, () => Promise<Record<string, any>>> = {
  organizations: () => import("src/models/Organizations"),
  counterparties: () => import("src/models/Counterparties"),
  contacttypes: () => import("src/models/ContactTypes"),
  contactpersons: () => import("src/models/ContactPersons/index"),
  contacts: () => import("src/models/Contacts"),
  contracts: () => import("src/models/Contracts"),
  bankaccounts: () => import("src/models/BankAccounts"),
  users: () => import("src/models/Users"),
  activityhistories: () => import("src/models/ActivityHistories"),
  todos: () => import("src/models/Todos"),
  notifications: () => import("src/models/Notifications"),
  brands: () => import("src/models/Brands"),
  products: () => import("src/models/Products"),
};

const listComponentNameMap: Record<string, string> = {
  organizations: "OrganizationsList",
  counterparties: "CounterpartiesList",
  contacttypes: "ContactTypesList",
  contactpersons: "ContactPersonsList",
  contacts: "ContactsList",
  contracts: "ContractsList",
  bankaccounts: "BankAccountsList",
  users: "UsersList",
  activityhistories: "ActivityHistoriesList",
  todos: "TodosList",
  notifications: "NotificationsList",
  brands: "BrandsList",
  products: "ProductsList",
};

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP MODAL — модальное окно с *List variant="select"
// ═══════════════════════════════════════════════════════════════════════════

interface LookupSelectModalProps {
  title: React.ReactNode;
  endpoint: string;
  listComponent?: FC<any>;
  onSelect: (item: Record<string, any>) => void;
  onClose: () => void;
}

const LookupSelectModal: FC<LookupSelectModalProps> = ({ title, endpoint, listComponent: ListComponentProp, onSelect, onClose }) => {
  const [ResolvedList, setResolvedList] = useState<FC<any> | null>(ListComponentProp || null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ленивая загрузка компонента списка по endpoint
  useEffect(() => {
    if (ListComponentProp) {
      setResolvedList(() => ListComponentProp);
      return;
    }
    const loader = listComponentRegistry[endpoint];
    if (!loader) {
      setLoadError(`Неизвестный endpoint: ${endpoint}`);
      return;
    }
    let cancelled = false;
    loader().then((mod) => {
      if (cancelled) return;
      const name = listComponentNameMap[endpoint];
      const Comp = mod[name] || mod.default;
      if (Comp) {
        setResolvedList(() => Comp);
      } else {
        setLoadError(`Компонент ${name} не найден в модуле`);
      }
    }).catch((err) => {
      if (!cancelled) setLoadError(err?.message || "Ошибка загрузки модуля");
    });
    return () => { cancelled = true; };
  }, [endpoint, ListComponentProp]);

  // Обработка выбора элемента
  const handleSelectItem = useCallback((item: Record<string, any>) => {
    onSelect(item);
  }, [onSelect]);

  return (
    <Modal
      title={`Выбор: ${title}`}
      onClose={onClose}
      style={{
        maxWidth: "900px",
        width: "90vw",
        // height: "70vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {loadError && (
          <div style={{ color: "red", padding: "16px", background: "#ffebee" }}>{loadError}</div>
        )}
        {!ResolvedList && !loadError && (
          <div style={{ padding: "24px", textAlign: "center", color: "#888" }}>Загрузка...</div>
        )}
        {ResolvedList && (
          <ResolvedList variant="select" onSelectItem={handleSelectItem} />
        )}
      </div>
    </Modal>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP FIELD — поле с кнопками "выбор" и "очистить"
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
}) => {
  // Подавляем неиспользуемые переменные совместимости
  void _columns;

  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = useCallback(() => {
    if (!disabled) setIsModalOpen(true);
  }, [disabled]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    const uuid = item.uuid as string;
    const display = String(item[displayField] ?? item.shortName ?? item.value ?? item.name ?? uuid);
    onSelect(uuid, display, item);
    setIsModalOpen(false);
  }, [onSelect, displayField]);

  const handleClear = useCallback(() => {
    onSelect("", "", {});
    onClear?.();
  }, [onSelect, onClear]);

  // Действия для кнопок
  const fieldActions = useMemo(() => {
    if (disabled) return [];
    const acts: { type: "clear" | "list" | "open"; onClick: () => void }[] = [];
    if (value) {
      acts.push({ type: "clear", onClick: handleClear });
    }
    acts.push({ type: "list", onClick: handleOpenModal });
    return acts;
  }, [disabled, value, handleClear, handleOpenModal]);

  return (
    <>
      <div
        className={styles.FieldWrapper}
        style={{
          width: width ?? "auto",
          maxWidth: maxWidth ?? "none",
          minWidth: minWidth ?? "none",
        }}
      >
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
        </label>

        <div className={styles.FieldInputWrapper}>
          <input
            type="text"
            id={name}
            name={name}
            value={displayValue || value}
            readOnly
            className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ""}`}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? "Выберите..."}
            onDoubleClick={handleOpenModal}
            style={{
              cursor: disabled ? "default" : "pointer",
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
      </div>

      {isModalOpen && (
        <LookupSelectModal
          title={label}
          endpoint={endpoint}
          listComponent={listComponent}
          onSelect={handleSelectItem}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
};

export default LookupField;
