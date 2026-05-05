import React, { FC, useRef, useEffect, useLayoutEffect, createContext, useState, ReactNode, CSSProperties, useCallback } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
// import Button from '../Button';
import { useAppContext } from 'src/app/context';
import { TypeFormMethod } from '../Table/types';
import { Button } from '../Button';
// import { useAppContext } from 'src/app/AppContextProvider';

type ModalButton = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
};

type ModalProps = {
  /** method-объект для управления состоянием (Table-совместимый). Опционален если передан onClose. */
  method?: TypeFormMethod;
  /** Колбэк применения. Если не передан — кнопка «Применить и закрыть» не отображается. */
  onApply?: () => void;
  /** Простой колбэк закрытия (альтернатива method). */
  onClose?: () => void;
  title: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
  /**
   * Полностью заменяет стандартный набор кнопок (Сохранить и закрыть / Отмена).
   * Используется, например, в ConfirmModal для кнопок «Да» / «Нет».
   */
  buttons?: ModalButton[];
};

import modalManager from './modalManager';

const ModalContextInstance = createContext<{ values: Record<string, any>; setValues: (values: Record<string, any>) => void } | null>(null);

const Modal: FC<ModalProps> = ({ method, onApply, onClose, title, style, children, buttons }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const AppContext = useAppContext();
  const { screenRef } = AppContext;
  const [values, setValues] = useState<Record<string, any>>({});

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (method) method.set('close');
  }, [onClose, method]);

  // Регистрируем модал в глобальном стеке, управляем Escape и blur
  useEffect(() => {
    const unregister = modalManager.registerModal(handleClose);
    return () => {
      unregister();
    };
  }, [handleClose, screenRef]);

  // Focus trap: keep focus inside modal and restore previous focus on unmount
  useLayoutEffect(() => {
    const modalEl = modalRef.current;
    if (!modalEl) return;

    // save previously focused element
    try { previouslyFocused.current = document.activeElement as HTMLElement | null; } catch { /* intentional */ }

    const focusableSelector = 'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable]';
    const modalBody = modalEl.querySelector<HTMLElement>('[data-modal-body="true"]');
    const focusRoot = modalBody ?? modalEl;
    const nodes = Array.from(focusRoot.querySelectorAll<HTMLElement>(focusableSelector));

    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    // focus first focusable or modal wrapper
    try {
      if (first) first.focus();
      else modalEl.focus();
    } catch { /* intentional */ }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === modalEl) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    modalEl.addEventListener('keydown', handleKeyDown as any);

    return () => {
      modalEl.removeEventListener('keydown', handleKeyDown as any);
      queueMicrotask(() => {
        // If another modal is still open, move focus into that modal instead of
        // restoring it to the element that opened the nested dialog.
        try {
          const remainingModals = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-root="true"]'));
          const topModal = remainingModals[remainingModals.length - 1];
          if (topModal) {
            const topModalBody = topModal.querySelector<HTMLElement>('[data-modal-body="true"]');
            const focusTargetRoot = topModalBody ?? topModal;
            const remainingNodes = Array.from(focusTargetRoot.querySelectorAll<HTMLElement>(focusableSelector));
            (remainingNodes[0] ?? topModal).focus();
            return;
          }
        } catch { /* intentional */ }

        try { previouslyFocused.current?.focus(); } catch { /* intentional */ }
      });
    };
  }, []);

  const handleOutsideClick = (e: React.MouseEvent) => {
    // Закрываем только при клике непосредственно по backdrop,
    // а не по вложенным порталам (другие модалки внутри)
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };
  const onApplyAndClose = () => {
    if (onApply) onApply();
    if (method) method.set('apply'); // модальное окно закроется в useEffect родителя
  }



  // if (method?.get === 'close') return null;

  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onClick={handleOutsideClick}>
      <div className={styles.ModalWrapper} ref={modalRef} style={{ ...style }} tabIndex={-1} data-modal-root="true">
        <div className={styles.ModalHeader}>
          <div className={styles.ModalTitle}>{title}</div>
          <div className={styles.ModalButtons}>
            {buttons
              ? buttons.map((btn, i) => (
                <Button key={i} onClick={btn.onClick} variant={btn.variant ?? 'primary'}>{btn.label}</Button>
              ))
              : <>
                {onApply && <Button onClick={onApplyAndClose} variant="secondary">Применить</Button>}
                <Button onClick={handleClose} variant="secondary">Отмена</Button>
              </>
            }
          </div>
        </div>
        <div className={styles.ModalBody} data-modal-body="true">
          <ModalContextInstance.Provider value={{ values, setValues }}>
            {children}
          </ModalContextInstance.Provider>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
