import React, { FC, useRef } from 'react'

import styles from "./Field.module.scss"

type TypeFieldStringProps = {
  label: string
  name: string
}

export const FieldString: FC<TypeFieldStringProps> = ({ label, name }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const handlerClearField = () => {
    if (inputRef.current)
      inputRef.current.value = ""
  }
  return (
    <div className={styles.rowGroup}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <div className={[styles.colGroup, styles.FieldWrapper].join(" ")}>
        <input ref={inputRef} type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' style={{ paddingRight: "52px" }} />
        <div className={styles.FieldActions}>
          <button onClick={() => handlerClearField()}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAU0lEQVR4nGNgGExgOgMDgzQR6qShajGAOAMDw0YChkgQUiOORwFBzfgMIVozNg0ka4YBkIatUEyyZooNkKDECxKUBKIEJdEoQYQteBMbxUl5YAAAD8MURVXG8WgAAAAASUVORK5CYII=" alt="delete-sign--v1" />
          </button>
          <button onClick={() => handlerClearField()}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAL0lEQVR4nGNgGEzgLQMDw38GBoY35BrwH42GsXFhDPCGUhdQDN6OhgHDaBgMFAAAbZ4r83tTZCIAAAAASUVORK5CYII=" alt="list" />
          </button>
        </div>
      </div>
    </div>
  );
};

type TypeFieldSelectProps = {
  label: string;
  name: string;
  options: { value: string; label: string }[];
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options }) => {
  return (
    <div className={styles.rowGroup}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <div className={[styles.colGroup, styles.FieldWrapper].join(" ")}>
        <select name={name} id={name} className={styles.FieldSelect}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export const SearchField: FC = () => {

  const inputRef = useRef<HTMLInputElement>(null)
  const handlerClearField = () => {
    if (inputRef.current)
      inputRef.current.value = ""
  }
  const searchField = "searchField";

  return (
    <div className={[styles.colGroup, styles.FieldWrapper].join(" ")}>
      <input
        ref={inputRef}
        type="search"
        placeholder="Быстрый поиск"
        name={searchField}
        id={searchField}
        className={styles.FieldString}
        autoComplete='off'
        style={{ width: "400px" }}
      />
      <div className={styles.FieldActions}>
        <button onClick={() => handlerClearField()}>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAU0lEQVR4nGNgGExgOgMDgzQR6qShajGAOAMDw0YChkgQUiOORwFBzfgMIVozNg0ka4YBkIatUEyyZooNkKDECxKUBKIEJdEoQYQteBMbxUl5YAAAD8MURVXG8WgAAAAASUVORK5CYII=" alt="delete-sign--v1" />
        </button>
        <button onClick={() => handlerClearField()}>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAL0lEQVR4nGNgGEzgLQMDw38GBoY35BrwH42GsXFhDPCGUhdQDN6OhgHDaBgMFAAAbZ4r83tTZCIAAAAASUVORK5CYII=" alt="list" />
        </button>
      </div>

      {/* <input type='search' placeholder='Быстрый поиск'
        className={styles.FieldString} autoComplete='off' /> */}
    </div>
  )
}

export const PeriodField: FC = () => {
  return (
    <div className={[styles.colGroup, styles.FieldWrapper].join(" ")}>
      <input type="datetime-local" className={styles.FieldString} />
      <input type="datetime-local" className={styles.FieldString} />
    </div>
  )
}

export const FieldGroup: FC<{ children: React.ReactNode }> = ({ children }) => {

  return (
    <div className={[styles.colGroup, styles.FieldGroup].join(" ")}>
      {children}
    </div>
  )
}

export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", margin: "3px 0" }}></div>
  )
}