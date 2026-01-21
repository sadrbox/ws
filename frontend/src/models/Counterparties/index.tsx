import { FC, ReactNode, useEffect, useState } from "react";
import columnsJson from "./columns.json";
import TableList from "src/components/Table";
import { useTable } from "src/hooks/useTable";
import { useAppContextProps } from "src/app/AppContextProvider";
import mainstyle from "../../app/styles/main.module.scss"
import useUID from 'src/hooks/useUID';
import { Divider, Field, FieldString } from 'src/components/Field/index.tsx';
import { Button } from "src/components/Button";
import { Group } from "src/components/UI";
import tabstyles from "src/components/Tabs/Tabs.module.scss";
import Tabs from "src/components/Tabs";
import ListOrganizations from "../organizations/list";
import ListContracts from "../Contracts";
import { TableBankAccounts } from "../BankAccounts";
import { LOCAL_API_URL } from "src/app/constants";

const styles = { ...tabstyles, ...mainstyle };
type TypeForm = {
  uid: string;
}

type TypeComponent = FC<{ children?: React.ReactNode }> & {
  List: FC;
  Form: FC<TypeForm>;
};

const Counterparties: TypeComponent = ({ children }) => {
  return <div className="counterparties">{children}</div>;
};

const List: FC = () => {
  const displayName = "Counterparties.List";
  const model = "Counterparties";

  // const form = (id: string) => <FormCounterparties id={id} />
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (uid: string) => addPane(<Counterparties.Form uid={uid} />);


  const { tableProps } = useTable({
    componentName: displayName,
    model,
    columnsJson,
    openForm
  });

  return <TableList props={tableProps} />;
};



// Интерфейс для данных формы (все поля из Prisma схемы)
interface CounterpartyFormData {
  bin: string;
  shortName: string;
  displayName: string;
  // Поля только для чтения (генерируются автоматически)
  id?: number;
  uuid?: string;
  createdAt?: string;
  updatedAt?: string;
}

const Form: React.FC<{ uid?: string; counterpartyId?: number }> = ({
  uid = "asdf2i3yt9bhweru",
  counterpartyId // для режима редактирования
}) => {
  const formUid = useUID();

  // Состояние формы
  const [formData, setFormData] = useState<CounterpartyFormData>({
    bin: '',
    shortName: '',
    displayName: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!counterpartyId);

  const tabs = [
    { id: "tab1", label: "Банковские счета", component: <ListOrganizations /> },
    { id: "tab2", label: "Договора", component: <ListOrganizations /> },
    { id: "tab3", label: "Контакты", component: <ListContracts /> },
  ];

  // Загрузка данных при редактировании
  useEffect(() => {
    if (counterpartyId) {
      loadCounterparty(counterpartyId);
    }
  }, [counterpartyId]);

  const loadCounterparty = async (id: number) => {
    setLoading(true);
    try {
      const response = await fetch(`${LOCAL_API_URL}/counterparties/${id}`);
      const result = await response.json();

      if (response.ok) {
        setFormData({
          bin: result.bin || '',
          shortName: result.shortName || '',
          displayName: result.displayName || '',
          id: result.id,
          uuid: result.uuid,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        });
      } else {
        setError('Не удалось загрузить данные контрагента');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  // Обработчик изменения полей
  const handleFieldChange = (field: keyof CounterpartyFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Отправка на сервер
  const handleSubmit = async (shouldClose: boolean = false) => {
    setLoading(true);
    setError(null);

    // Подготовка данных (соответствие модели Prisma)
    const payload = {
      bin: formData.bin?.trim() || '',
      shortName: formData.shortName?.trim() || null,
      displayName: formData.displayName?.trim() || null,
    };

    // Валидация
    if (!payload.bin || payload.bin.length !== 12 || !/^\d{12}$/.test(payload.bin)) {
      setError("БИН должен состоять ровно из 12 цифр");
      setLoading(false);
      return;
    }

    try {
      const url = isEditMode
        ? `${LOCAL_API_URL}/counterparties/${formData.id}`
        : `${LOCAL_API_URL}/counterparties`;

      const method = isEditMode ? 'PUT' : 'POST';

      console.log('Отправка данных:', { url, method, payload });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('Статус ответа:', response.status);

      let result;
      try {
        result = await response.json();
        console.log('Ответ сервера:', result);
      } catch (parseError) {
        console.error('Ошибка парсинга JSON:', parseError);
        throw new Error('Сервер вернул некорректный ответ');
      }

      if (!response.ok) {
        // Обработка разных типов ошибок
        if (response.status === 409) {
          throw new Error('Контрагент с таким БИН уже существует');
        }
        if (response.status === 400) {
          const errorMsg = result.errors?.join(', ') || result.message || 'Ошибка валидации';
          throw new Error(errorMsg);
        }
        throw new Error(result.message || `Ошибка сервера (${response.status})`);
      }

      // Успех
      const message = isEditMode
        ? 'Контрагент успешно обновлен!'
        : 'Контрагент успешно создан! ID: ' + result.id;

      alert(message);

      if (shouldClose) {
        console.log('→ Закрываем форму');
        // onClose?.();
      } else if (!isEditMode) {
        // Переключаемся в режим редактирования после создания
        setIsEditMode(true);
        setFormData(prev => ({
          ...prev,
          id: result.id,
          uuid: result.uuid,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        }));
      }

    } catch (err: any) {
      const errorMessage = err.message || 'Не удалось сохранить контрагента';
      setError(errorMessage);
      console.error('Ошибка при сохранении:', err);
    } finally {
      setLoading(false);
    }
  };

  // Форматирование даты
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: 'flex-start' }}>
            <Button
              variant="primary"
              onClick={() => handleSubmit(true)}
              disabled={loading}
            >
              <span>{loading ? 'Сохранение...' : 'Сохранить и закрыть'}</span>
            </Button>

            <Divider />

            <Button
              onClick={() => handleSubmit(false)}
              disabled={loading}
            >
              <span>{loading ? 'Сохранение...' : 'Сохранить'}</span>
            </Button>

            <Button onClick={() => {/* логика закрытия без сохранения */ }}>
              <span>Закрыть</span>
            </Button>

            <Divider />
          </div>
        </div>
        <div className={styles.TablePanelRight}></div>
      </div>

      {error && (
        <div style={{ color: 'red', padding: '8px', margin: '8px 0' }}>
          {error}
        </div>
      )}

      <div className={styles.FormBody}>
        <div className={styles.FormBodyParts}>
          <Group label="Основная информация" align="row" gap="12px" className={styles.Form}>
            <div style={{ gap: '12px', display: 'flex', flexDirection: 'column', flex: 1 }}>
              {/* БИН - обязательное поле */}
              <Field
                label="БИН / ИНН *"
                name={`${formUid}_bin`}
                width="300px"
                value={formData.bin}
                onChange={(e) => handleFieldChange('bin', e.target.value)}
                disabled={isEditMode} // БИН нельзя менять после создания
              />

              {/* Короткое наименование */}
              <Field
                label="Короткое наименование"
                name={`${formUid}_shortName`}
                maxWidth="500px"
                value={formData.shortName || ''}
                onChange={(e) => handleFieldChange('shortName', e.target.value)}
              />

              {/* Полное наименование */}
              <Field
                label="Полное наименование"
                name={`${formUid}_displayName`}
                maxWidth="600px"
                value={formData.displayName || ''}
                onChange={(e) => handleFieldChange('displayName', e.target.value)}
              />
            </div>
          </Group>

          {/* Системные поля (только для чтения) */}
          {isEditMode && (
            <>
              <Divider />
              <Group label="Системная информация" align="row" gap="12px" className={styles.Form}>
                <div style={{ gap: '12px', display: 'flex', flexDirection: 'row', flexWrap: 'wrap' }}>
                  <Field
                    label="ID"
                    name={`${formUid}_id`}
                    width="100px"
                    value={formData.id?.toString() || ''}
                    onChange={() => { }} // read-only
                    disabled={true}
                  />

                  <Field
                    label="UUID"
                    name={`${formUid}_uuid`}
                    width="300px"
                    value={formData.uuid || ''}
                    onChange={() => { }} // read-only
                    disabled={true}
                  />

                  <Field
                    label="Дата создания"
                    name={`${formUid}_createdAt`}
                    width="200px"
                    value={formatDate(formData.createdAt)}
                    onChange={() => { }} // read-only
                    disabled={true}
                  />

                  <Field
                    label="Дата обновления"
                    name={`${formUid}_updatedAt`}
                    width="200px"
                    value={formatDate(formData.updatedAt)}
                    onChange={() => { }} // read-only
                    disabled={true}
                  />
                </div>
              </Group>
            </>
          )}

          <Divider />

          {/* Табы с связанными данными */}
          <div className={styles.FormTable}>
            <Tabs tabs={tabs} />
          </div>
        </div>
      </div>
    </div>
  );
};



List.displayName = "Counterparties.List";
Form.displayName = "Counterparties.Form";
// Прикрепляем подкомпоненты к основному
Counterparties.List = List;
Counterparties.Form = Form;

export default Counterparties;


