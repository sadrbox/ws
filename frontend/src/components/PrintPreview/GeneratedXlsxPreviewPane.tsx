import type { FC } from "react";
import type { WorkBook } from "xlsx";
import GeneratedXlsxPreview from "./GeneratedXlsxPreview";

// Обёртка вокруг GeneratedXlsxPreview для запуска как PaneItem.
// PaneItem рендерит компонент через <Component {...pane} />, где данные
// расположены в pane.data. Здесь мы извлекаем из data реальные пропсы.

interface PaneXlsxData {
  workbook: WorkBook;
  fileBaseName: string;
  title?: string;
}

const GeneratedXlsxPreviewPane: FC<{ data?: PaneXlsxData }> = ({ data }) => {
  if (!data || !data.workbook) {
    return <div style={{ padding: 16 }}>Нет данных для предпросмотра</div>;
  }
  return (
    <GeneratedXlsxPreview
      workbook={data.workbook}
      fileBaseName={data.fileBaseName}
      title={data.title}
    />
  );
};

GeneratedXlsxPreviewPane.displayName = "GeneratedXlsxPreviewPane";
export default GeneratedXlsxPreviewPane;
