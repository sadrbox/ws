import { FC, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "notifications";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface NotificationsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}

const NotificationsList: FC<NotificationsListProps> = ({ variant = 'default', onSelectItem } = {}) => {
  const componentName = "NotificationsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson, defaultSort: { createdAt: "desc" },
  });

  // Открытие задачи по клику на уведомление
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const todoUuid = d?.todoUuid as string | undefined;
    if (!todoUuid) return;
    // Ленивый импорт Todos
    import("src/models/Todos").then(({ TodosForm }) => {
      addPane({
        label: `${t("TodosList")}: ${(d as any)?.todo?.shortName || t("noName")} • ${(d as any)?.todo?.id ?? "?"}`,
        component: TodosForm,
        data: { uuid: todoUuid } as TDataItem,
        onSave: () => refetch(),
        onClose: () => refetch(),
      });
    });
  }, [addPane, t, refetch]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

NotificationsList.displayName = "NotificationsList";
export { NotificationsList };
