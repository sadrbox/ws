/**
 * Тема оформления (E5). Значение хранится в localStorage и применяется атрибутом
 * data-theme на <html>. При отсутствии выбора действует системная тема
 * (prefers-color-scheme отрабатывает в CSS сам). Ранний скрипт в index.html
 * выставляет data-theme ДО первой отрисовки, чтобы не было вспышки.
 */
export type Theme = "light" | "dark";

const KEY = "theme";

/** Явно выбранная тема ("light"|"dark") или null, если следуем системной. */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Тема, действующая СЕЙЧАС (с учётом системной, если явного выбора нет). */
export function getEffectiveTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Применить и запомнить тему. null — вернуться к системной. */
export function setTheme(theme: Theme | null): void {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  const root = document.documentElement;
  if (theme) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}

/** Переключить light↔dark относительно ДЕЙСТВУЮЩЕЙ темы. */
export function toggleTheme(): Theme {
  const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
