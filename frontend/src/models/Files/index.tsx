import { FC } from "react";
import FilesPanel from "src/components/FilesPanel";

// ═══════════════════════════════════════════════════════════════════════════
// FILES LIST — общий список ВСЕХ прикреплённых файлов (пункт меню «Файлы»).
// Загрузка с прогрессом — внутри FilesPanel (allFiles); клик по строке
// открывает просмотрщик файла (FileViewPane на DocViewport) — поведение по
// умолчанию FilesPanel (то же и в панелях файлов сущностей).
// ═══════════════════════════════════════════════════════════════════════════

const FilesList: FC = () => <FilesPanel allFiles />;
FilesList.displayName = "FilesList";

export { FilesList };
export default FilesList;
