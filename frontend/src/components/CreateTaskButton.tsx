// Кнопка «Создать задачу» для шапки панели (PaneItemHeaderToolbar). Создаёт задачу
// ИЗ ТЕКУЩЕГО ОБЪЕКТА (документ/справочник): задача ссылается на него как «Источник»
// (sourceType/sourceUuid), с предзаполнением организации из записи. Так задачи
// порождаются объектом, а не заметкой (заметки связаны только с объектом).
import { FC, useCallback } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import apiClient from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/datetime";

const CreateTaskButton: FC<{ endpoint: string; uuid?: string }> = ({ endpoint, uuid }) => {
  const { windows: { addPane } } = useAppContext();

  const createTask = useCallback(async () => {
    if (!uuid) return;
    let organizationUuid: string | undefined;
    let organizationName: string | undefined;
    // Ссылка-подпись объекта: имя (справочник) либо «№ номер - дата» (документ).
    // Имя типа задача добавит сама из реестра — здесь только сама ссылка.
    let sourceLabel = "";
    try {
      const r = await apiClient.get<{ item?: Record<string, unknown> }>(`${endpoint}/${uuid}`);
      const item = r.data?.item;
      if (item) {
        organizationUuid = (item.organizationUuid as string) || undefined;
        organizationName = ((item.organization as { name?: string } | undefined)?.name) || undefined;
        if (item.name) {
          sourceLabel = String(item.name);
        } else if (item.number) {
          const date = item.date ? ` - ${getFormatDateOnly(String(item.date))}` : "";
          sourceLabel = `№ ${item.number}${date}`;
        }
      }
    } catch { /* запись без организации — задача создастся без предзаполнения орг */ }

    const { TodosForm } = await import("src/models/Todos");
    addPane({
      label: translate("TodosForm") || "Задача",
      component: TodosForm,
      // sourceType/Uuid/Label — ссылка задачи на объект-источник (чип «Источник»
      // в форме задачи открывает сам объект по клику).
      data: { organizationUuid, organizationName, sourceType: endpoint, sourceUuid: uuid, sourceLabel },
    });
  }, [endpoint, uuid, addPane]);

  if (!uuid) return null; // задачу создаём только у сохранённой записи

  return (
    <IconButton
      title={translate("createTaskFromObject")}
      aria-label={translate("createTaskFromObject")}
      onClick={() => void createTask()}
    >
      <Icon name="calendar" />
    </IconButton>
  );
};

export default CreateTaskButton;
