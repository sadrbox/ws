import { Divider, Field } from "src/components/Field";
import reload_16 from "src/assets/reload_16.png"; // Adjust the path to the image file
import styles from "../../styles/main.module.scss"; // Adjust the path to your CSS module
import { Group } from "src/components/UI";
import { getFormatDate } from "src/utils/main.module";
import { TDataItem } from "src/components/Table/types";
import { FC, useCallback, useEffect, useState } from "react";
import { TOpenModelFormProps } from "src/app/types";
import { useAppContext } from "src/app";
import useUID from "src/hooks/useUID";
// import { OrganizationsList } from "../Organizations";
// import { EHttpMethod, getElementByUuid } from "src/utils/api_old";
import { Button, ButtonImage } from "src/components/Button";
import Tabs from "src/components/Tabs";
import apiClient from "src/app/services/api/client";
interface TFormData extends Partial<TDataItem> {
  bin: string;
  shortName: string;
  displayName: string;
}

// Предполагаемые табы (замени на реальные компоненты)
const tabs = [
  { id: 'tab1', label: 'Банковские счета', component: <div>Список счетов (реализуйте)</div> },
  { id: 'tab2', label: 'Договора', component: <div>Список договоров (реализуйте)</div> },
];

const CounterpartiesForm: FC<TOpenModelFormProps> = ({ onSave, onClose, data, uniqId }) => {
  const { uuid, id, createdAt, updatedAt } = data ?? {};
  // const { onSave, onClose } = formProps ?? {};

  const { windows: { removePane } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>({
    bin: '',
    shortName: '',
    displayName: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  // Загрузка данных при монтировании в режиме редактирования
  useEffect(() => {
    if (uuid) {
      loadFormData(uuid);
    }
  }, [uuid]);

  const loadFormData = useCallback(async (uuid: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<TFormData>(`/api/counterparties/${uuid}`);
      const loadedData = response.data;

      setFormData({
        ...loadedData,
        // bin: loadedData.bin,
        // shortName: loadedData.shortName ?? '',
        // displayName: loadedData.displayName ?? '',
        id: loadedData.id,
        uuid: loadedData.uuid,
        createdAt: loadedData.createdAt,
        updatedAt: loadedData.updatedAt,

      });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Не удалось загрузить данные контрагента');
      console.error('Ошибка загрузки:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Обработчик изменения полей
  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Отправка формы
  const submit = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Валидация
    const binTrimmed = formData.bin?.trim() || '';
    if (!binTrimmed || binTrimmed.length !== 12 || !/^\d{12}$/.test(binTrimmed)) {
      setError('БИН должен состоять ровно из 12 цифр');
      setIsLoading(false);
      return;
    }

    const payload = {
      bin: binTrimmed,
      shortName: formData.shortName?.trim() || null,
      displayName: formData.displayName?.trim() || null,
    };

    try {
      let response;
      if (isEditMode && uuid) {
        // Обновление
        response = await apiClient.put<TDataItem>(`/api/counterparties/${uuid}`, payload);
      } else {
        // Создание
        response = await apiClient.post<TDataItem>('/api/counterparties', payload);
      }

      const savedData = response.data;

      // Обновляем форму после успешного сохранения
      setFormData({
        ...formData,
        ...savedData,
      });

      setIsEditMode(true); // переходим в режим редактирования после создания

      // Успешное сохранение
      !!onSave && onSave();
    } catch (err: any) {
      let errorMessage = 'Не удалось сохранить контрагента';
      if (err.response?.status === 409) {
        errorMessage = 'Контрагент с таким БИН уже существует';
      } else if (err.response?.status === 400) {
        errorMessage = err.response.data?.message || 'Ошибка валидации на сервере';
      } else {
        errorMessage = err.message || `Ошибка сервера (${err.response?.status || 'неизвестно'})`;
      }

      setError(errorMessage);
      console.error('Ошибка сохранения:', err);
    } finally {
      setIsLoading(false);
    }
  }, [formData, isEditMode, uuid, onSave]);

  const handleSave = useCallback(() => {
    submit();
  }, [submit]);

  const handleSaveAndClose = useCallback(async () => {
    await submit();
    if (!error) {
      onSave?.();
      onClose?.();
      if (uniqId) {
        removePane(uniqId);
      }
    }
  }, [submit, error, onSave, onClose, removePane, uniqId]);

  const handleClose = useCallback(() => {
    onClose?.();
    if (uniqId) {
      removePane(uniqId);
    }
  }, [onClose, removePane, uniqId]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(' ')} style={{ justifyContent: 'flex-start' }}>
            <Divider />
            <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}>
              <span>Сохранить и закрыть</span>
            </Button>
            <Divider />
            <Button onClick={handleSave} disabled={isLoading}>
              <span>Сохранить</span>
            </Button>
            <Button onClick={handleClose} disabled={isLoading}>
              <span>Закрыть</span>
            </Button>
            <Divider />
            {isEditMode && (
              <ButtonImage
                onClick={() => uuid && loadFormData(uuid)}
                title="Обновить данные"
                disabled={isLoading}
              >
                <img
                  src={reload_16}
                  alt="Reload"
                  height={16}
                  width={16}
                  className={isLoading ? styles.animationLoop : ''}
                />
              </ButtonImage>
            )}
          </div>
        </div>
        <div className={styles.TablePanelRight} />
      </div>

      {error && (
        <div style={{ color: 'red', padding: '12px', margin: '8px 0', background: '#ffebee', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      <div className={styles.FormBody}>
        <div className={styles.FormBodyParts}>
          <Group label="Основная информация" align="row" gap="12px" className={styles.Form}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              <Field
                label="Наименование"
                name={`${formUid}_shortName`}
                minWidth="339px"
                value={formData.shortName || ''}
                onChange={(e) => handleFieldChange('shortName', e.target.value)}
                disabled={isLoading}
              />
              <Field
                label="Полное наименование"
                name={`${formUid}_displayName`}
                minWidth="339px"
                value={formData.displayName || ''}
                onChange={(e) => handleFieldChange('displayName', e.target.value)}
                disabled={isLoading}
              />
              <Field
                label="БИН / ИНН *"
                name={`${formUid}_bin`}
                minWidth="339px"
                value={formData.bin}
                onChange={(e) => handleFieldChange('bin', e.target.value)}
                disabled={isLoading || isEditMode} // БИН нельзя менять после создания
              />
            </div>
          </Group>

          {isEditMode && (
            <>
              <Divider />
              <Group label="Системная информация" align="row" gap="12px" className={styles.Form}>
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '12px' }}>
                  <Field
                    label="ID"
                    name={`${formUid}_id`}
                    width="100px"
                    value={formData.id?.toString() || '-'}
                    disabled
                  />
                  <Field
                    label="UUID"
                    name={`${formUid}_uuid`}
                    width="300px"
                    value={formData.uuid || '-'}
                    disabled
                  />
                  <Field
                    label="Дата создания"
                    name={`${formUid}_createdAt`}
                    width="200px"
                    value={getFormatDate(formData.createdAt)}
                    disabled
                  />
                  <Field
                    label="Дата обновления"
                    name={`${formUid}_updatedAt`}
                    width="200px"
                    value={getFormatDate(formData.updatedAt)}
                    disabled
                  />
                </div>
              </Group>
            </>
          )}

          <Divider />

          {/* Табы с подтаблицами */}
          <div className={styles.FormTable}>
            <Tabs tabs={tabs} />
          </div>
        </div>
      </div>
    </div>
  );
};

CounterpartiesForm.displayName = 'CounterpartiesForm';
export default CounterpartiesForm;