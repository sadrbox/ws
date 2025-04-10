import React, { ReactNode, useEffect, useRef, useState } from "react";
import styles from './styles.module.scss';
import imgDownloadPdf from 'src/assets/download-pdf.png'
import imgPrinting from 'src/assets/printing.png'
import imgReloadData from 'src/assets/reload-data.png'

// Компонент для страницы A4
const A4Page: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div
      style={{
        // display: 'flex',
        // flex: 1,
        // flexDirection: 'column',
        // justifyContent: 'center',
        // minWidth: "600px",
        maxWidth: '800px',
        // height: "1123px",
        margin: "0px auto",
        padding: "20px",
        boxSizing: "border-box",
        backgroundColor: "#fff",
        boxShadow: "0 0 10px rgba(0, 0, 0, 0.1)",
        border: "1px solid #ddd",
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
};

// Основной компонент для отображения страницы
type PrintPageViewerProps = {
  children: ReactNode;
};

const PrintPageViewer: React.FC<PrintPageViewerProps> = ({ children }) => {



  return (
    <div className={styles.GridWrapper}>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '5px' }}>
          <button className={styles.Button}>
            <img src={imgPrinting} />
            <span>Печать</span></button>
          <button className={styles.Button}>
            <img src={imgDownloadPdf} />
            <span>Скачать файл</span></button>
        </div>
        <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '5px' }}>
          <button className={[styles.Button, styles.ButtonImg].join(' ')}>
            <img src={imgReloadData} />
            <span>Обновить</span>
          </button>
          <button className={[styles.Button].join(' ')}>
            <span>Еще</span>
          </button>
        </div>
      </div>
      <div className={styles.GridSrollWrapper} style={{ justifyContent: 'center', }}>
        <A4Page>{children}</A4Page>
      </div>
    </div>


  );
};
export default PrintPageViewer;
