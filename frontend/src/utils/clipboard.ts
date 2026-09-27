/**
 * Запись текста в буфер обмена. Возвращает, удалось ли.
 *
 * Сначала — Clipboard API. Его может не быть (страница не в защищённом контексте) или он
 * откажет (нет разрешения) — тогда старый путь: скрытое поле + execCommand("copy"). Поле
 * забирает фокус, поэтому после копирования фокус возвращается туда, где был: иначе
 * клавиатура таблицы, из которой копировали, переставала бы отвечать.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Отказ Clipboard API — пробуем старый путь ниже.
  }
  return copyViaCommand(text);
}

function copyViaCommand(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const focused = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  try { focused?.focus({ preventScroll: true }); } catch { focused?.focus(); }
  return ok;
}
