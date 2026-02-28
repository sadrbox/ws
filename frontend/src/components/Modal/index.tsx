import { FC, useRef, useEffect, createContext, useContext, useState, ReactNode, CSSProperties, useCallback } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
// import Button from '../Button';
import { useAppContext } from 'src/app/index';
import { TypeFormMethod } from '../Table/types';
import { Button } from '../Button';
// import { useAppContext } from 'src/app/AppContextProvider';

type ModalProps = {
  /** method-объект для управления состоянием (Table-совместимый). Опционален если передан onClose. */
  method?: TypeFormMethod;
  /** Колбэк применения. Если не передан — кнопка «Применить и закрыть» не отображается. */
  onApply?: () => void;
  /** Простой колбэк закрытия (альтернатива method). */
  onClose?: () => void;
  title: string;
  style?: CSSProperties;
  children: ReactNode;
};

// ── Глобальный стек модалов для правильной обработки Escape ──────────────
// Только самый верхний (последний в стеке) модал реагирует на Escape.
const modalStack: Array<() => void> = [];

// Глобальный счётчик открытых модалов для управления blur на .Screen
let openModalCount = 0;

let globalEscapeListenerAttached = false;
const globalEscapeHandler = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && modalStack.length > 0) {
    e.preventDefault();
    e.stopPropagation();
    const topClose = modalStack[modalStack.length - 1];
    if (topClose) topClose();
  }
};

const ModalContextInstance = createContext<{ values: Record<string, any>; setValues: (values: Record<string, any>) => void } | null>(null);

export const useModalContextProps = () => {
  const context = useContext(ModalContextInstance);
  if (!context) throw new Error('useModalContext должен использоваться внутри DataGridFilter');
  return { ...context };
};

const Modal: FC<ModalProps> = ({ method, onApply, onClose, title, style, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const AppContext = useAppContext();
  const { screenRef } = AppContext;
  const [values, setValues] = useState<Record<string, any>>({});

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (method) method.set('close');
  }, [onClose, method]);

  // Регистрируем модал в глобальном стеке, управляем Escape и blur
  useEffect(() => {
    modalStack.push(handleClose);

    // Blur: добавляем при первом открытом модале
    openModalCount++;
    if (openModalCount === 1) {
      screenRef.current?.classList.add(styles.blur5);
    }

    // Подключаем глобальный listener при первом модале
    if (!globalEscapeListenerAttached) {
      window.addEventListener('keydown', globalEscapeHandler, true);
      globalEscapeListenerAttached = true;
    }

    return () => {
      // Убираем себя из стека
      const idx = modalStack.lastIndexOf(handleClose);
      if (idx !== -1) modalStack.splice(idx, 1);

      // Blur: снимаем только когда закрывается последний модал
      openModalCount--;
      if (openModalCount === 0) {
        screenRef.current?.classList.remove(styles.blur5);
      }

      // Отключаем глобальный listener когда модалов не осталось
      if (modalStack.length === 0 && globalEscapeListenerAttached) {
        window.removeEventListener('keydown', globalEscapeHandler, true);
        globalEscapeListenerAttached = false;
      }
    }
  }, [handleClose]);

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
      <div className={styles.ModalWrapper} ref={modalRef} style={{ ...style }}>
        <div className={styles.ModalButtons}>
          {onApply && <Button onClick={onApplyAndClose} variant="primary">Применить и закрыть</Button>}
          {/* <Button onClick={onApply} variant="primary">Применить</Button> */}
          <Button onClick={handleClose} variant="secondary">Закрыть</Button>
        </div>
        <div className={styles.ModalTitle}>{title}</div>
        <div className={styles.ModalBody}>
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
