import { FC, useRef, useEffect, createContext, useContext, useState, ReactNode } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
import Button from '../Button';
import { useAppContext } from 'src/components/app/AppContextProvider';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, any>) => void;
  title: string;
  children: ReactNode;
};

const ModalContextInstance = createContext<{ values: Record<string, any>; setValues: (values: Record<string, any>) => void } | null>(null);

export const useModalContextProps = () => {
  const context = useContext(ModalContextInstance);
  if (!context) throw new Error('useModalContext должен использоваться внутри DataGridFilter');
  return { ...context };
};

const Modal: FC<ModalProps> = ({ isOpen, onClose, onSubmit, title, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const AppContext = useAppContext();
  const { context: { screenRef } } = AppContext;;
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

  const handleSubmit = () => {
    onSubmit(values);
    onClose();
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onClick={handleOutsideClick}>
      <div className={styles.ModalWrapper} ref={modalRef}>
        {/* <div className={styles.ModalTitle}>{title}</div> */}
        <div className={styles.ModalButtons}>
          <Button onClick={handleSubmit} variant="primary">Применить</Button>
          <Button onClick={onClose} variant="secondary">Закрыть</Button>
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
