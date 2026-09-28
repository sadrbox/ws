import React, { FC, useRef, useEffect, useLayoutEffect, createContext, useState, ReactNode, CSSProperties, useCallback, useId } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
import { TypeFormMethod } from '../Table/types';
import { Button } from '../Button';
import { translate } from 'src/i18';

type ModalButton = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
};

type ModalProps = {
  /** method-объект для управления состоянием (Table-совместимый). Опционален если передан onClose. */
  method?: TypeFormMethod;
  /**
   * Колбэк применения. Если не передан — кнопка «Применить и закрыть» не отображается.
   * Может вернуть промис — тогда «Применить» не принимает нажатий, пока он не завершится.
   */
  onApply?: () => void | Promise<unknown>;
  /** Погасить «Применить» (например, пока идёт запрос: `mutation.isPending`). */
  applyDisabled?: boolean;
  /** Простой колбэк закрытия (альтернатива method). */
  onClose?: () => void;
  title: ReactNode;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
  /**
   * Полностью заменяет стандартный набор кнопок (Сохранить и закрыть / Отмена).
   * Используется, например, в ConfirmModal для кнопок «Да» / «Нет».
   */
  buttons?: ModalButton[];
};

import modalManager from './modalManager';

/**
 * Сколько «Применить» не принимает повторных нажатий, если onApply синхронный (запускает
 * мутацию и не возвращает промис). Двойной щелчок укладывается в это окно — без него
 * создавались два агента и дважды перевыпускался токен (аудит 26.09, И14).
 */
const APPLY_LOCK_MS = 600;

const focusableSelector = 'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable]';

/**
 * Можно ли прийти сюда по Tab (КР-21 аудита 27.09). Селектор отбирает кандидатов, а ловушка сама
 * переводит фокус по списку — и в список попадали скрытые узлы (display:none: скрытый
 * <input type=file> у FieldFile; visibility:hidden) и кнопки с tabIndex=-1 (действия полей:
 * «Быстрый выбор», «Выбрать из списка» — браузер их обходит). focus() на скрытом — пустой вызов:
 * Tab застревал, и в окне «Загрузить расширение» до имени и «Применить» было не добраться.
 * `hidden` — кэш «узел скрыт display:none» на один обход (предки у полей общие).
 */
function isTabbable(el: HTMLElement, root: HTMLElement, hidden: Map<Element, boolean>): boolean {
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex !== null && Number(tabIndex) < 0) return false;
  try {
    if (el.matches(':disabled')) return false;
  } catch { /* старый движок без :disabled */ }
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  const own = view.getComputedStyle(el).visibility;
  if (own === 'hidden' || own === 'collapse') return false;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) {
    let isHidden = hidden.get(n);
    if (isHidden === undefined) {
      isHidden = n.hidden || view.getComputedStyle(n).display === 'none';
      hidden.set(n, isHidden);
    }
    if (isHidden) return false;
  }
  return true;
}

/** Узлы обхода Tab внутри контейнера — только те, куда фокус правда встанет. */
function tabbableIn(container: HTMLElement | null, root: HTMLElement, hidden: Map<Element, boolean>): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => isTabbable(el, root, hidden));
}

const ModalContextInstance = createContext<{ values: Record<string, unknown>; setValues: (values: Record<string, unknown>) => void } | null>(null);

const Modal: FC<ModalProps> = ({ method, onApply, applyDisabled = false, onClose, title, style, className, children, buttons }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const titleId = useId();

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (method) method.set('close');
  }, [onClose, method]);

  // Регистрируем модал в глобальном стеке (Escape, blur фона) ОДИН раз — на монтировании.
  // Колбэк держим в ref: раньше каждая смена инлайн-onClose перерегистрировала окно, и
  // внешняя модалка вставала в стеке ВЫШЕ вложенной — Escape закрывал не то окно (И14).
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;
  useEffect(() => {
    const unregister = modalManager.registerModal(() => closeRef.current());
    return () => {
      unregister();
    };
  }, []);

  // Focus trap: keep focus inside modal and restore previous focus on unmount
  useLayoutEffect(() => {
    const modalEl = modalRef.current;
    if (!modalEl) return;

    // save previously focused element
    try { previouslyFocused.current = document.activeElement as HTMLElement | null; } catch { /* intentional */ }

    const bodyOf = () => modalEl.querySelector<HTMLElement>('[data-modal-body="true"]');
    // Порядок обхода Tab: сначала поля тела, затем кнопки шапки («Применить»/«Отмена»,
    // «Да»/«Отмена»). Узлы собираем НА КАЖДОЕ нажатие: тело может появиться позже
    // (асинхронная загрузка), а раньше снимок при монтировании запирал Tab навсегда;
    // кнопки шапки раньше были недостижимы с клавиатуры вовсе (аудит 26.09, И14).
    // Только видимые узлы без tabIndex=-1 (КР-21, isTabbable).
    const collect = (): { inBody: HTMLElement[]; header: HTMLElement[] } => {
      const hidden = new Map<Element, boolean>();
      return {
        inBody: tabbableIn(bodyOf(), modalEl, hidden),
        header: tabbableIn(modalEl.querySelector<HTMLElement>('[data-modal-header="true"]'), modalEl, hidden),
      };
    };

    // focus first focusable of the body or modal wrapper
    try {
      const first = collect().inBody[0];
      if (first) first.focus();
      else modalEl.focus();
    } catch { /* intentional */ }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const { inBody, header } = collect();
      const nodes = [...inBody, ...header];
      if (nodes.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? nodes.indexOf(active) : -1;
      let next: number;
      if (idx !== -1) {
        next = (idx + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      } else if (active && active !== modalEl && bodyOf()?.contains(active)) {
        // Фокус на узле вне обхода (кнопка поля с tabIndex=-1 после щелчка) — продолжаем от его
        // места в теле, а не с начала окна.
        const after = inBody.findIndex((n) => (active.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
        if (e.shiftKey) {
          const prev = (after === -1 ? inBody.length : after) - 1;
          next = prev >= 0 ? prev : nodes.length - 1;
        } else {
          next = after !== -1 ? after : (inBody.length < nodes.length ? inBody.length : 0);
        }
      } else {
        next = e.shiftKey ? nodes.length - 1 : 0;
      }
      try { nodes[next].focus(); } catch { /* intentional */ }
    };

    modalEl.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      modalEl.removeEventListener('keydown', handleKeyDown as EventListener);
      queueMicrotask(() => {
        // If another modal is still open, move focus into that modal instead of
        // restoring it to the element that opened the nested dialog.
        try {
          const remainingModals = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-root="true"]'));
          const topModal = remainingModals[remainingModals.length - 1];
          if (topModal) {
            const topModalBody = topModal.querySelector<HTMLElement>('[data-modal-body="true"]');
            const focusTargetRoot = topModalBody ?? topModal;
            const remainingNodes = tabbableIn(focusTargetRoot, topModal, new Map());
            (remainingNodes[0] ?? topModal).focus();
            return;
          }
        } catch { /* intentional */ }

        try { previouslyFocused.current?.focus(); } catch { /* intentional */ }
      });
    };
  }, []);

  // Закрываем по фону, только если и НАЖАТИЕ было на фоне: выделение текста в поле
  // с отпусканием кнопки над фоном даёт click на общем предке — это не «щелчок мимо окна».
  const downOnBackdropRef = useRef(false);
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    downOnBackdropRef.current = e.target === e.currentTarget;
  };
  const handleOutsideClick = (e: React.MouseEvent) => {
    // Закрываем только при клике непосредственно по backdrop,
    // а не по вложенным порталам (другие модалки внутри)
    const downOnBackdrop = downOnBackdropRef.current;
    downOnBackdropRef.current = false;
    if (e.target === e.currentTarget && downOnBackdrop) {
      handleClose();
    }
  };

  // «Применить» — не чаще одного раза, пока предыдущее нажатие не отработало.
  const [applyBusy, setApplyBusy] = useState(false);
  const applyLockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const onApplyAndClose = () => {
    if (applyLockRef.current || applyDisabled) return;
    applyLockRef.current = true;
    setApplyBusy(true);
    const release = () => {
      applyLockRef.current = false;
      if (mountedRef.current) setApplyBusy(false);
    };
    let result: unknown;
    try {
      if (onApply) result = onApply();
      if (method) method.set('apply'); // модальное окно закроется в useEffect родителя
    } catch (err) {
      release();
      throw err;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).then(release, release);
    } else {
      setTimeout(release, APPLY_LOCK_MS);
    }
  };




  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onMouseDown={handleBackdropMouseDown} onClick={handleOutsideClick}>
      <div
        className={`${styles.ModalWrapper}${className ? ` ${className}` : ''}`}
        ref={modalRef}
        style={style}
        tabIndex={-1}
        data-modal-root="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.ModalHeader} data-modal-header="true">
          <div className={styles.ModalTitle} id={titleId}>{title}</div>
          <div className={styles.ModalButtons}>
            {buttons
              ? buttons.map((btn, i) => (
                <Button key={i} onClick={btn.onClick} variant={btn.variant ?? 'primary'}>{btn.label}</Button>
              ))
              : <>
                {onApply && <Button onClick={onApplyAndClose} variant="secondary" disabled={applyDisabled || applyBusy}>{translate("apply")}</Button>}
                <Button onClick={handleClose} variant="secondary">{translate("cancel")}</Button>
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
