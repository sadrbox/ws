import React, { CSSProperties, Dispatch, FC, HTMLAttributes, SetStateAction, useRef } from 'react'

import styles from "./Field.module.scss"
import { useTableContextProps } from '../Table'
import { TypeDateRange } from '../Table/types'
import { Group } from 'src/app/DesignSystem'

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
    <Group align="row" className={styles.FieldWrapper}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <Group align="col" className={styles.FieldInputWrapper}>
        <input ref={inputRef} type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' style={{ paddingRight: "52px" }} />
        <div className={styles.FieldActions}>
          <button onClick={() => handlerClearField()}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAU0lEQVR4nGNgGExgOgMDgzQR6qShajGAOAMDw0YChkgQUiOORwFBzfgMIVozNg0ka4YBkIatUEyyZooNkKDECxKUBKIEJdEoQYQteBMbxUl5YAAAD8MURVXG8WgAAAAASUVORK5CYII=" alt="delete-sign--v1" />
          </button>
          <button onClick={() => handlerClearField()}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAL0lEQVR4nGNgGEzgLQMDw38GBoY35BrwH42GsXFhDPCGUhdQDN6OhgHDaBgMFAAAbZ4r83tTZCIAAAAASUVORK5CYII=" alt="list" />
          </button>
        </div>
      </Group>
    </Group>
  );
};

type TypeFieldSelectProps = {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  style?: CSSProperties;
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options, style }) => {
  return (
    <Group align="row" className={styles.FieldWrapper} style={style}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <Group align="col" className={styles.FieldSelectWrapper}>
        <select name={name} id={name} className={styles.FieldSelect} >
          {
            options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          }
        </select >
      </Group >
    </Group >
  );
};

type TypeFieldAutocompleteProps = {
  label: string;
  name: string;
  style?: CSSProperties;
  // attributes?: HTMLAttributes<HTMLInputElement>;
}
export const FieldAutocomplete: FC<TypeFieldAutocompleteProps> = ({ label, name, style }) => {
  return (
    <Group align="row" className={styles.FieldWrapper} style={style}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <Group align="col" className={styles.FieldInputWrapper}>
        <input
          type="text"
          id={name}
          name={name}
          autoComplete='off'
          placeholder=""
          className={styles.FieldString}
        />
      </Group>
    </Group>
  );
};

export const SearchField: FC = () => {

  // const APP_CONTEXT_PROPS = useAppContextProps();
  const TABLE_CONTEXT_PROPS = useTableContextProps();
  // const {loadDataGrid} = TABLE_CONTEXT_PROPS.actions;
  const { setFastSearchQuery } = TABLE_CONTEXT_PROPS.states;
  const inputRef = useRef<HTMLInputElement>(null)
  // const [inputValue, setInputValue] = useState("")
  // const deferredValue = useDeferredValue(fastSearchQuery) // "медленное" значение

  const handlerClearField = () => {
    setFastSearchQuery("")
    if (inputRef.current)
      inputRef.current.value = ""
    // loadDataGrid()
  }

  const handlerChangeInputValue = (e: React.ChangeEvent<HTMLInputElement>) => {
    // if (e.target.value.length > 3)
    setFastSearchQuery(e.target.value);
    // if (loadDataGrid)
    //   loadDataGrid()

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
        // value={fastSearchQuery}
        onChange={handlerChangeInputValue}
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

// type TypeFieldPeriodProps = {setSearchPeriod: ({startDate, endDate}: TypeDateRange) => void };
type TypeFieldDateRangeProps = { props: { dateRange: TypeDateRange, setDateRange: Dispatch<SetStateAction<TypeDateRange>> }; style?: CSSProperties };

export const PeriodField: FC<TypeFieldDateRangeProps> = ({ props: { dateRange, setDateRange } }) => {

  return (
    <Group align="col" className={[styles.FieldWrapper, styles.gap6].join(" ")}>
      <input
        type="datetime-local"
        className={styles.FieldString}
        value={dateRange.startDate ? dateRange.startDate : ''}
        onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
      />
      <input
        type="datetime-local"
        className={styles.FieldString}
        value={dateRange.endDate ? dateRange.endDate : ''}
        onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))} />
    </Group>
  )
}



export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", margin: "3px 0" }}></div>
  )
}

