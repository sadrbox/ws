import { FC, useRef, useEffect, createContext, useContext, useState, ReactNode, CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.scss';
import Button from '../Button';
import { useAppContextProps } from 'src/app/AppContextProvider';
import { TypeFormMethod } from '../Table/types';
// import { useAppContext } from 'src/app/AppContextProvider';

type ModalProps = {
  method: TypeFormMethod;
  onApply: () => void;
  title: string;
  style?: CSSProperties
  children: ReactNode;
};

const ModalContextInstance = createContext<{ values: Record<string, any>; setValues: (values: Record<string, any>) => void } | null>(null);

export const useModalContextProps = () => {
  const context = useContext(ModalContextInstance);
  if (!context) throw new Error('useModalContext должен использоваться внутри DataGridFilter');
  return { ...context };
};

const Modal: FC<ModalProps> = ({ method, onApply, title, style, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const AppContext = useAppContextProps();
  const { screenRef } = AppContext;
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (method?.get === 'open') { screenRef.current?.classList.add(styles.blur5); }
    return () => { screenRef.current?.classList.remove(styles.blur5); }

    // else screenRef.current?.classList.remove(styles.blur5);
  }, [method]);

  useEffect(() => {
    // screenRef.current?.classList.add(styles.blur5);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') method?.set('close');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [method]);

  const handleOutsideClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      method?.set('close');
    }
  };
  const onApplyAndClose = () => {
    onApply();
    method?.set('apply')
  }



  // if (method?.get === 'close') return null;

  return ReactDOM.createPortal(
    <div className={styles.ModalBackground} onClick={handleOutsideClick}>
      <div className={styles.ModalWrapper} ref={modalRef} style={{ ...style }}>
        <div className={styles.ModalHeader}>
          <div className={styles.ModalButtons}>
            <Button onClick={onApplyAndClose} variant="primary">Применить и закрыть</Button>
            {/* <Button onClick={onApply} variant="primary">Применить</Button> */}
            <Button onClick={() => method?.set('close')} variant="secondary">Закрыть</Button>
          </div>
        </div>
        <div className={styles.ModalBody}>
          <div className={styles.ModalTitle}>{title}</div>
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
