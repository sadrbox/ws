/**
 * Откуда взялась задача: происхождение, ссылка на объект и подписи для списка и карточки
 * (ПН1, ПН2 плана PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22).
 *
 * ДВЕ РАЗНЫЕ ВЕЩИ, ДВЕ РАЗНЫЕ ПАРЫ ПОЛЕЙ:
 *   origin / originLabel      — ОТКУДА пришла задача («из чата в 1С, база Dev_01»);
 *   sourceType / sourceUuid / sourceLabel — НА ЧТО она ссылается (реализация, заметка, контрагент).
 * Раньше происхождение писали в `sourceType`, и связать задачу из 1С с созданным документом было
 * нельзя: поле одно, а смыслов два. Записи, созданные до этой правки, читаются по-старому — см.
 * `originOf`: миграция их перенесла, но чужая копия базы может быть и не перенесена.
 *
 * Отдельным модулем, а не в index.tsx: тот отдаёт компоненты, и функции рядом с ними ломают
 * горячую перезагрузку (react-refresh). Здесь же им и место — ими пользуются и форма, и список.
 */
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import { getByEndpoint } from "src/registry/modelRegistry";
import type { TDataItem } from "src/components/Table/types";

/** Происхождение «из чата в 1С»: так его пишет бэкенд (`/bpai`, поле origin). */
export const ONEC_CHAT_SOURCE = "1c-chat";

/** Приставка типа у объекта, который лежит В 1С, а не в ERP: открыть его в панели нельзя. */
export const ONEC_OBJECT_PREFIX = "1c:";

/**
 * Происхождение записи с учётом старых данных: до появления `origin` метку клали в `sourceType`,
 * а подпись базы — в `sourceLabel`.
 */
export function originOf(row: { origin?: unknown; originLabel?: unknown; sourceType?: unknown; sourceLabel?: unknown } & object): { origin: string; label: string } {
  const origin = asText(row.origin);
  if (origin) return { origin, label: asText(row.originLabel) };
  const legacy = asText(row.sourceType);
  return legacy === ONEC_CHAT_SOURCE ? { origin: legacy, label: asText(row.sourceLabel) } : { origin: "", label: "" };
}

export const isFromOnec = (row: Parameters<typeof originOf>[0]): boolean => originOf(row).origin === ONEC_CHAT_SOURCE;

/** «Из 1С — Dev_01»: имя базы берём из подписи бэкенда, но своё слово ставим впереди. */
export function onecOriginLabel(label: string | null | undefined): string {
  const raw = (label ?? "").trim();
  // «Чат в 1С — Dev_01» → «Dev_01»: тире с пробелами ставит бэкенд, других разделителей там нет.
  const base = raw.includes("—") ? raw.split("—").slice(1).join("—").trim() : "";
  return base ? `${translate("todoFromOnec")} — ${base}` : translate("todoFromOnec");
}

/** Объект 1С открыть в панели нечем: его там нет. Показываем подпись, ссылку не делаем. */
export const isOnecObject = (sourceType: string | null | undefined): boolean =>
  (sourceType ?? "").startsWith(ONEC_OBJECT_PREFIX);

/**
 * Подпись ссылки на объект: человекочитаемое имя типа из реестра моделей («Реализация ТМЗ и
 * услуг») + ссылка на запись («№ 12 - 01.02.2026»), вместо сырого кода типа («sales»/«Sale»).
 * У объекта 1С имени типа в реестре нет — там подпись пришла от самой 1С («Реализация №12»).
 */
export function sourceChipLabel(sourceType: string, sourceLabel: string): string {
  if (isOnecObject(sourceType)) {
    const label = sourceLabel || sourceType.slice(ONEC_OBJECT_PREFIX.length);
    return `${label} · ${translate("todoOnecObject")}`;
  }
  const typeName = getByEndpoint(sourceType)?.label || translate(sourceType) || sourceType;
  // sourceLabel мог оказаться самим кодом типа (старые данные) — тогда игнорируем.
  const ref = sourceLabel && sourceLabel !== sourceType ? sourceLabel : "";
  return ref ? `${typeName} ${ref}` : typeName;
}

/**
 * Колонка «Источник» (ПН1). Из 1С — «Из 1С — Dev_01»; если задача к тому же связана с документом,
 * рядом стоит и он: это разные сведения, и показывать одно вместо другого нельзя.
 * У задачи, заведённой руками и ни с чем не связанной, — прочерк.
 */
export function sourceCellText(row: TDataItem): string {
  const { origin, label } = originOf(row);
  const parts: string[] = [];
  if (origin === ONEC_CHAT_SOURCE) parts.push(onecOriginLabel(label));
  const type = asText(row.sourceType);
  if (type && type !== ONEC_CHAT_SOURCE) parts.push(sourceChipLabel(type, asText(row.sourceLabel)));
  return parts.length ? parts.join(" · ") : "—";
}
