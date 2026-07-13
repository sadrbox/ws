// ─────────────────────────────────────────────────────────────────────────────
// paneLink — короткие ссылки на открытие конкретной панели (форма документа/
// справочника, список, отчёт, файл). Кодируем «рецепт» панели (TPaneRestore)
// компактной схемой `<тип>~<сегменты>` в query-параметр ?open=…; при открытии
// ссылки приложение проигрывает рецепт через restorePane.
//
// Формат (без избыточного base64-JSON и без метки — метку выводит restorePane):
//   список   l~<ref>
//   форма    f~<endpoint>~<uuid>
//   файл     x~<uuid>~<имя файла>
//   отчёт    r~<key>[~<base64(json data)>]
//   панель   v~<имя компонента>[~<uuid>]
// ─────────────────────────────────────────────────────────────────────────────
import type { TPaneRestore } from "src/app/types";
import { showToast } from "src/components/UIToast";

const PARAM = "open";

function encodeRestore(r: TPaneRestore): string {
  switch (r.kind) {
    // Панель-представление: имя компонента (+ uuid записи для форм).
    case "view": return r.data?.uuid ? `v~${r.name}~${r.data.uuid}` : `v~${r.name}`;
    case "list": return `l~${r.ref}`;
    case "form": return `f~${r.endpoint}~${r.uuid ?? ""}`;
    case "file": return `x~${r.uuid}~${r.fileName ?? ""}`;
    case "report": return r.data ? `r~${r.key}~${btoa(encodeURIComponent(JSON.stringify(r.data)))}` : `r~${r.key}`;
  }
}

function decodeRestore(s: string): TPaneRestore | null {
  if (s.length < 2 || s[1] !== "~") return null;
  const type = s[0];
  const rest = s.slice(2);          // часть после "<тип>~"
  const i = rest.indexOf("~");      // первый разделитель внутри сегментов
  try {
    switch (type) {
      case "v": {
        const name = i < 0 ? rest : rest.slice(0, i);
        const uuid = i < 0 ? "" : rest.slice(i + 1);
        return uuid ? { kind: "view", name, data: { uuid } } : { kind: "view", name };
      }
      case "l":
        return { kind: "list", ref: rest };
      case "f": {
        if (i < 0) return null;
        return { kind: "form", endpoint: rest.slice(0, i), uuid: rest.slice(i + 1) || undefined };
      }
      case "x": {
        const uuid = i < 0 ? rest : rest.slice(0, i);
        const fileName = i < 0 ? "" : rest.slice(i + 1); // имя — остаток (может содержать «~»)
        return { kind: "file", uuid, fileName: fileName || undefined };
      }
      case "r": {
        const key = i < 0 ? rest : rest.slice(0, i);
        const data = i < 0 ? undefined : JSON.parse(decodeURIComponent(atob(rest.slice(i + 1))));
        return { kind: "report", key, data };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Полный URL-адрес для открытия панели по рецепту (только параметр ?open). */
export function buildPaneLink(restore: TPaneRestore): string {
  const { origin, pathname } = window.location;
  const url = new URL(`${origin}${pathname}`);
  url.searchParams.set(PARAM, encodeRestore(restore));
  return url.toString();
}

/** Считывает рецепт панели из query-строки (или null). */
export function readPaneLink(search: string): TPaneRestore | null {
  const raw = new URLSearchParams(search).get(PARAM);
  return raw ? decodeRestore(raw) : null;
}

/** Убирает параметр open из адресной строки (после открытия панели). */
export function clearPaneLinkParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Копирует короткую ссылку на панель в буфер обмена (+ тост). */
export async function copyPaneLink(restore: TPaneRestore): Promise<void> {
  const link = buildPaneLink(restore);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("Ссылка скопирована", "success");
  } catch {
    showToast("Не удалось скопировать ссылку", "error");
  }
}
