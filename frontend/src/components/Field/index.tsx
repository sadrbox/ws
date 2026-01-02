import React, { CSSProperties, FC, useDeferredValue, useEffect, useRef, useState } from 'react'

import styles from "./Field.module.scss"
import { useTableContextProps } from '../Table'
import { TypeDateRange } from '../Table/types'
import { Group } from 'src/components/UI'
import useUID from 'src/hooks/useUID'

type TypeFieldStringProps = {
  label: string
  name: string
  width?: string | number
  maxWidth?: string | number
}
export type TypeFieldActions = {
  img?: string;
  alt?: string;
  type: 'clear' | 'list' | 'open';
  onClick: () => void;
}[];


type TypeFieldFilterProps = {
  actions: TypeFieldActions;
  name: string;
  label: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

type TypeFieldGroupProps = {
  name: string;
  label: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  actions?: TypeFieldActions;
  style?: CSSProperties;
}

export const imgActions = {
  clear: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3,3 L13,13 M13,3 L3,13" stroke="currentColor" strokeWidth="0.5" fill="none" strokeLinecap="round" />
    </svg>),
    alt: "clear-sign--v1",
  },
  list: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="3" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="6" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="9" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="12" width="14" height="1" fill="currentColor" rx="0.5" />
    </svg>),
    alt: "list-sign--v1",
  },
  open: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" rx="0.5" />
      <rect x="3" y="3" width="10" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="5" width="8" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="7" width="6" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="9" width="4" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="11" width="6" height="1" fill="currentColor" rx="0.5" />
    </svg>),
    alt: "open-sign--v1",
  }
}

export const Field: FC<TypeFieldStringProps> = ({ label, name, width, maxWidth }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleList = () => {
    console.log("List action");
  };


  const actions: TypeFieldActions = [
    { type: "clear", onClick: handleClear },
    { type: "list", onClick: handleList },
    { type: "open", onClick: () => { console.log("Open action"); } },
  ];


  return (
    <FieldGroup
      name={name}
      label={label}
      inputRef={inputRef}
      style={{ width: width ?? 'auto', maxWidth: maxWidth ?? 'none', }}
    // actions={actions}
    />
  );
};

export const FieldGroup: FC<TypeFieldGroupProps> = ({ name, label, inputRef, actions, style }) => {

  return (
    <div className={styles.FieldWrapper} style={style ? { ...style, width: style?.width } : style}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <div className={styles.FieldInputWrapper}>
        <input ref={inputRef} type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' style={{ ...(actions && { paddingRight: `${actions.length * 30}px` }) }} />
        <div className={styles.FieldActions}>
          {
            actions && actions.map((action, index) => (
              <button key={index} onClick={action.onClick} type='button'>
                {/* <img src={imgActions[action.type].img} alt={imgActions[action.type].alt} /> */}
                {imgActions[action.type].img}
              </button>
            ))
          }
        </div>
      </div>
    </div>
  );
};

export const FieldFilter: FC<TypeFieldFilterProps> = ({ label, name, actions }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <FieldGroup
      name={name}
      label={label}
      inputRef={inputRef}
      actions={actions}
    />
  );
};

export const FieldString: FC<TypeFieldStringProps> = ({ label, name }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleList = () => {
    console.log("List action");
  };


  const actions: TypeFieldActions = [
    { type: "clear", onClick: handleClear },
    { type: "list", onClick: handleList },
    { type: "open", onClick: () => { console.log("Open action"); } },
  ];
  return (
    <FieldGroup
      name={name}
      label={label}
      inputRef={inputRef}
      actions={actions}
    />
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

export const FieldFastSearch: FC = () => {

  // const APP_CONTEXT_PROPS = useAppContextProps();
  const TABLE_CONTEXT_PROPS = useTableContextProps();
  const { queryParams, setQueryParams } = TABLE_CONTEXT_PROPS.query;
  const [queryValue, setQueryValue] = useState<string>(queryParams.filter?.searchBy?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null)
  const deferredValue = useDeferredValue(queryValue) // "медленное" значение


  const visibleColumns = TABLE_CONTEXT_PROPS.columns.filter(col => col.visible === true).map(col => ({ identifier: col.identifier, type: col.type })) ?? [];


  useEffect(() => {
    if (setQueryParams)
      setQueryParams({ page: 1, filter: { searchBy: { value: deferredValue, columns: visibleColumns } } })
  }, [deferredValue])

  const handlerClearField = () => {
    setQueryValue("")
    // setQueryParams(prev => ({ ...prev, filter: { searchBy: { value: "", columns: [] }, dateRange: { ...prev.filter?.dateRange } } }))
    if (inputRef.current)
      inputRef.current.value = ""
  }

  const handlerChangeInputValue = (e: React.ChangeEvent<HTMLInputElement>) => {
    // console.log(queryParams)
    setQueryValue(e.target.value)
    // setQueryParams(prev => ({ ...prev, filter: { searchBy: { value: e.target.value, columns: visibleColumns }, dateRange: { ...prev.filter?.dateRange } } }))
  }

  // const action = {
  //   img: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAU0lEQVR4nGNgGExgOgMDgzQR6qShajGAOAMDw0YChkgQUiOORwFBzfgMIVozNg0ka4YBkIatUEyyZooNkKDECxKUBKIEJdEoQYQteBMbxUl5YAAAD8MURVXG8WgAAAAASUVORK5CYII=",
  //   alt: "delete-sign--v1",
  // }

  const UID = useUID();
  const fieldUID = `FIELD_${UID}`;
  // const searchField = "searchField";

  return (
    <div className={styles.FieldInputWrapper} >
      <input
        ref={inputRef}
        type="text"
        placeholder="Поиск..."
        name={fieldUID}
        id={fieldUID}
        className={styles.FieldString}
        autoComplete='off'
        style={{ paddingRight: "30px" }}
        value={deferredValue}
        onChange={handlerChangeInputValue}
      />
      <div className={styles.FieldActions}>
        <button onClick={() => handlerClearField()}>
          {imgActions.clear.img}
        </button>
      </div>
    </div>
  )
}

// type TypeFieldPeriodProps = {setSearchPeriod: ({startDate, endDate}: TypeDateRange) => void };
// type TypeFieldDateRangeProps = { props: { dateRange: TypeDateRange, setDateRange: Dispatch<SetStateAction<TypeDateRange>> }; style?: CSSProperties };

export const FieldDateRange: FC = () => {
  const TABLE_CONTEXT_PROPS = useTableContextProps();
  const { queryParams, setQueryParams } = TABLE_CONTEXT_PROPS.query;
  const [dateRange, setDateRange] = useState<TypeDateRange | undefined>(queryParams.filter?.dateRange);

  // const startDate = queryParams.filter?.dateRange?.startDate;
  // const endDate = queryParams.filter?.dateRange?.endDate;
  useEffect(() => {
    if (setQueryParams)
      setQueryParams({ page: 1, filter: { dateRange } })
  }, [dateRange])

  return (
    <div className={styles.FieldDateWrapper} >
      <input
        type="datetime-local"
        className={styles.FieldDate}
        value={dateRange?.startDate ? dateRange.startDate : ''}
        onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
      // name="startDate"
      /><span>-</span>
      <input
        type="datetime-local"
        className={styles.FieldDate}
        value={dateRange?.endDate ? dateRange.endDate : ''}
        onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
      // name="endDate"
      />
    </div>
  )
}

export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", display: "flex", height: "auto" }}></div>
  )
};