import { FC, useEffect, useState } from 'react';
import _ from "lodash";
import styles from "./styles.module.scss";
import axios from 'axios';
import { TDataItem } from 'src/components/ui/Grid/types';
import imgArrow from "src/assets/arrow.png";
import { useAppContext } from 'src/components/app/AppContext';
import { getFormatDate } from 'src/utils/main.module'
import { getTranslation } from "src/i18/index"



type TPropsActivityHistoryView = {
  id?: string | number;
}

type TProps = {
  [key: string]: string[] | string; // props могут быть как строкой, так и массивом строк
};

type TActivityHistory = {
  id: number;
  actionDate: string;
  actionType: string;
  bin: string;
  userName: string;
  host: string;
  ip: string;
  city: string;
  objectId: string;
  objectType: string;
  objectName: string;
  props: TProps; // props — это объект, где ключи могут быть строками, а значения могут быть строками или массивами строк
};

const ActivityHistoryView: FC<TPropsActivityHistoryView> = ({ id }) => {
  const [data, setData] = useState<TActivityHistory | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { context: appContext } = useAppContext();
  const elementID = (appContext?.elementID ? appContext.elementID : id)

  useEffect(() => {

    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`http://192.168.1.112:3000/api/v1/history/${elementID}`);
        setData(response.data);
        setError(null);
      } catch (err: any) {
        console.error("Error fetching activity history:", err);
        setError(err.response?.data?.error || "Ошибка при загрузке данных.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [elementID]);

  // if (loading) return <div>Загрузка...</div>;
  // if (error) return <div>Ошибка: {error}</div>;

  if (data !== null) {
    // console.log(r)

    return (
      <div className={styles.ViewWrapper}>
        <h2>История активности объекта</h2>
        <div className="ViewBody">
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'auto' }}>
            {_.entries(data).map(([key, v], mapID) => (
              <div key={mapID}>
                {_.isObject(v) ? (
                  <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'auto' }}>
                    <h3>История значений</h3>
                    {
                      _.entries(v).map(([keyP, vP], mapIDp) => (
                        <div key={mapIDp} style={{ display: 'flex', flexDirection: 'column', gap: '10px', }}>
                          <div style={{ borderBottom: '1px dotted gray', flex: 1, fontWeight: 'bold' }}>{keyP}</div>
                          <div style={{ display: 'flex' }}><img src={imgArrow} style={{ height: '13px', alignSelf: "flex-end", marginRight: '10px' }} /> {(vP[0] !== '') ? String(vP[0]) : "---"}</div>
                          <div style={{ display: 'flex' }}><img src={imgArrow} style={{ height: '13px', alignSelf: "flex-start", marginRight: '10px', transform: 'rotate(-90deg)' }} /> {(vP[1] !== '') ? String(vP[1]) : "---"}</div>

                        </div>
                      ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1, borderBottom: '1px dotted gray', fontWeight: '400' }}>{getTranslation(key)}</div>
                    <div>{(key === 'actionDate' ? getFormatDate(String(v)) : String(v))}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div >
      </div>
    );
  };
}

export default ActivityHistoryView;