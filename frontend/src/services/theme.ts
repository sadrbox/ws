/**
 * Тема оформления (E5). OPT-IN тёмная: по умолчанию СВЕТЛАЯ, системный
 * prefers-color-scheme:dark НЕ включает тёмную автоматически (мы всегда ставим
 * явный data-theme=light|dark). Тёмная — только явным выбором пользователя
 * (хранится в localStorage). Ранний скрипт в index.html выставляет data-theme
 * ДО первой отрисовки (без вспышки).
 */
export type Theme = "light" | "dark";

const KEY = "theme";

/** Явно выбранная тема ("light"|"dark") или null, если выбора не было (=светлая). */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Тема, действующая СЕЙЧАС. По умолчанию светлая (системную dark не авто-включаем). */
export function getEffectiveTheme(): Theme {
  return getStoredTheme() === "dark" ? "dark" : "light";
}

/** Применить и запомнить тему. null — сброс к светлой (значение по умолчанию). */
export function setTheme(theme: Theme | null): void {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  // Всегда явный атрибут (никогда не убираем) — иначе системный dark «протёк» бы
  // через @media(prefers-color-scheme:dark):not([data-theme=light]).
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

/** Переключить light↔dark относительно ДЕЙСТВУЮЩЕЙ темы. */
export function toggleTheme(): Theme {
  const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
