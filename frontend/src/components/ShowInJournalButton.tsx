/**
 * ShowInJournalButton — кнопка «Показать в журнале» в шапке формы документа.
 *
 * Открывает *List документа и подсвечивает текущий документ: строка получает
 * activeRow и прокручивается В ЦЕНТР видимой области (см. listHighlight + Table).
 * Самоскрывается, пока документ не сохранён (нет uuid).
 */
import { FC } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { useAppContext } from "src/app";
import { setPendingHighlight } from "src/utils/listHighlight";
import { openListByRef } from "src/registry/formRegistry";

const ShowInJournalButton: FC<{ endpoint: string; uuid?: string }> = ({ endpoint, uuid }) => {
  const { windows: { addPane } } = useAppContext();
  if (!uuid) return null;
  return (
    <IconButton
      icon="list"
      title="Показать в журнале"
      aria-label="Показать в журнале"
      onClick={() => {
        setPendingHighlight(endpoint, uuid);
        void openListByRef(endpoint, addPane);
      }}
    />
  );
};

export default ShowInJournalButton;
