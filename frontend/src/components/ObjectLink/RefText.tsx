/**
 * RefText — текст, в котором токены ссылок `[[ref:<код>|<подпись>]]` отрисованы
 * кликабельными чипами <ObjectLink>, а остальное выводится как обычный текст.
 *
 * Используется в сообщениях чата; годится для любого пользовательского текста
 * (заметки, описание задачи), где нужны ссылки на объекты системы.
 */
import { FC, Fragment, useMemo } from "react";
import { parseRefSegments } from "src/utils/objectRef";
import ObjectLink from "./index";

const RefText: FC<{ text: string }> = ({ text }) => {
  const segments = useMemo(() => parseRefSegments(text), [text]);
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {segment.type === "text"
            ? segment.text
            : <ObjectLink objectRef={segment.ref} />}
        </Fragment>
      ))}
    </>
  );
};
RefText.displayName = "RefText";

export default RefText;
