import { useState, useCallback, useRef } from "react";

export interface ConfirmState {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Promise-based хук для подтверждения действий через модальное окно.
 *
 * Пример использования:
 * ```
 * const { confirm, confirmState } = useConfirm();
 *
 * const handleDelete = async () => {
 *   if (!(await confirm("Удалить запись?"))) return;
 *   // удаляем...
 * };
 *
 * return (
 *   <>
 *     ...
 *     <ConfirmModal {...confirmState} />
 *   </>
 * );
 * ```
 */
export function useConfirm() {
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;

      setConfirmState({
        isOpen: true,
        message,
        onConfirm: () => {
          resolveRef.current = null;
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          resolve(true);
        },
        onCancel: () => {
          resolveRef.current = null;
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          resolve(false);
        },
      });
    });
  }, []);

  return { confirm, confirmState };
}
