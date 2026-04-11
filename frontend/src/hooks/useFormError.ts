import { useState, useCallback } from "react";

/**
 * Хук для управления ошибками формы, устойчивый к React-батчингу.
 *
 * Проблема: при вызове setError(null) + setError("тот же текст")
 * в одном синхронном блоке React 18 батчит оба обновления, и если
 * текст ошибки не изменился — FormError не перерисовывается,
 * анимация и таймер auto-dismiss не перезапускаются.
 *
 * Решение: каждый вызов setError с непустым сообщением увеличивает
 * revision-счётчик. FormError получает revision и использует его
 * как key — гарантируя перемонтирование при каждой новой ошибке.
 *
 * Использование:
 * ```tsx
 * const [error, setError, errorRevision] = useFormError();
 * // ...
 * setError("Ошибка валидации");  // revision++
 * setError(null);                 // очистка
 * setError("Ошибка валидации");  // revision++ (даже если текст тот же)
 * // ...
 * <FormError message={error} revision={errorRevision} onDismiss={() => setError(null)} />
 * ```
 */
export function useFormError(): [
  error: string | null,
  setError: (msg: string | null) => void,
  revision: number,
] {
  const [error, setErrorRaw] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const setError = useCallback((msg: string | null) => {
    setErrorRaw(msg);
    if (msg) {
      setRevision(r => r + 1);
    }
  }, []);

  return [error, setError, revision];
}
