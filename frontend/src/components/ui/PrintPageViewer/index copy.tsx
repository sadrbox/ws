import React, { ReactNode, useEffect, useRef, useState } from "react";

// Компонент для страницы A4
const A4Page: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div
      style={{
        width: "794px",
        // height: "1123px",
        margin: "10px",
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
    <div
      style={{
        width: "min-content",
        height: "600px",
        border: "1px solid #ccc",
        borderRadius: "2px",
        overflow: "auto",
        backgroundColor: "#f9f9f9",
      }}
    >
      {/* Невидимый контейнер для тестирования */}
      <div
        style={{
          visibility: "hidden",
          position: "absolute",
          width: "794px",
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          lineHeight: "1.5",
          whiteSpace: "pre-wrap",
        }}
      ></div>

      {/* Рендерим страницы */}
      <A4Page>{children}</A4Page>

    </div>
  );
};
export default PrintPageViewer;
