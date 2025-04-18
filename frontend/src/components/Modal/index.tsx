import { FC, useRef, useEffect, createContext, useContext, useState, ReactNode } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
import Button from '../Button';
import { useAppContextProps } from 'src/app/AppContextProvider';
// import { useAppContext } from 'src/app/AppContextProvider';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApply: () => void;
  title: string;
  children: ReactNode;
};

const ModalContextInstance = createContext<{ values: Record<string, any>; setValues: (values: Record<string, any>) => void } | null>(null);

export const useModalContextProps = () => {
  const context = useContext(ModalContextInstance);
  if (!context) throw new Error('useModalContext должен использоваться внутри DataGridFilter');
  return { ...context };
};

const Modal: FC<ModalProps> = ({ isOpen, onClose, onApply, title, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const AppContext = useAppContextProps();
  const { screenRef } = AppContext;
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (isOpen) { screenRef.current?.classList.add(styles.blur5); }
    return () => { screenRef.current?.classList.remove(styles.blur5); }

    // else screenRef.current?.classList.remove(styles.blur5);
  }, [isOpen]);

  useEffect(() => {
    // screenRef.current?.classList.add(styles.blur5);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [onClose]);

  const handleOutsideClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };
  const handleApplyAndClose = () => {
    onApply();
    onClose();
  }



  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onClick={handleOutsideClick}>
      <div className={styles.ModalWrapper} ref={modalRef}>
        <div className={styles.ModalHeader}>
          <div className={styles.ModalTitle}>{title}</div>
          <div className={styles.ModalButtons}>
            <Button onClick={handleApplyAndClose} variant="primary">Применить и закрыть</Button>
            {/* <Button onClick={onApply} variant="primary">Применить</Button> */}
            <Button onClick={onClose} variant="secondary">Закрыть</Button>
          </div>
        </div>
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
