/**
 * Откуда взялась задача: подписи и признаки источника (ПН1, ПН2 плана
 * PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22).
 *
 * Отдельным модулем, а не в index.tsx: тот отдаёт компоненты, и функции рядом с ними ломают
 * горячую перезагрузку (react-refresh). Здесь же им и место — ими пользуются и форма, и список.
 */
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import { getByEndpoint } from "src/registry/modelRegistry";
import type { TDataItem } from "src/components/Table/types";

/*
 * ЗАДАЧА ИЗ ЧАТА В 1С (ПН1). Бэкенд помечает такие записи `sourceType = "1c-chat"`, а в `sourceLabel`
 * пишет, из какой базы они пришли («Чат в 1С — Dev_01»). Поля заполнялись, но нигде не показывались:
 * задача появлялась в списке будто ниоткуда, и автор у неё — пользователь, которого в панели никто не
 * заводил. Ссылки на объект у такой задачи нет (документа-источника не было), поэтому чип «Источник»
 * для неё не годится — нужна отдельная подпись.
 */
export const ONEC_CHAT_SOURCE = "1c-chat";

export const isFromOnec = (sourceType: string | null | undefined): boolean => sourceType === ONEC_CHAT_SOURCE;

/** «Из 1С — Dev_01»: имя базы берём из подписи бэкенда, но своё слово ставим впереди. */
export function onecSourceLabel(sourceLabel: string | null | undefined): string {
  const raw = (sourceLabel ?? "").trim();
  // «Чат в 1С — Dev_01» → «Dev_01»: тире с пробелами ставит бэкенд, других разделителей там нет.
  const base = raw.includes("—") ? raw.split("—").slice(1).join("—").trim() : "";
  return base ? `${translate("todoFromOnec")} — ${base}` : translate("todoFromOnec");
}

export function sourceChipLabel(sourceType: string, sourceLabel: string): string {
  const typeName = getByEndpoint(sourceType)?.label || translate(sourceType) || sourceType;
  // sourceLabel мог оказаться самим кодом типа (старые данные) — тогда игнорируем.
  const ref = sourceLabel && sourceLabel !== sourceType ? sourceLabel : "";
  return ref ? `${typeName} ${ref}` : typeName;
}

/**
 * Колонка «Источник» (ПН1): откуда взялась задача. Из 1С — с базой, из документа — тип и ссылка
 * («Реализация ТМЗ и услуг № 12»), из панели — прочерк: у задачи, заведённой руками, источника нет.
 */
export function sourceCellText(row: TDataItem): string {
  const type = asText(row.sourceType);
  const label = asText(row.sourceLabel);
  if (isFromOnec(type)) return onecSourceLabel(label);
  return type ? sourceChipLabel(type, label) : "—";
}
