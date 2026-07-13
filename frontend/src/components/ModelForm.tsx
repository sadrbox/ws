import { FC, ReactNode, useRef } from "react";
import { translate } from "src/i18";
import FormPanel from "src/components/FormPanel";
import Tabs from "src/components/Tabs";
import { usePaneToolbar, usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import skeletonStyles from "./ModelForm.module.scss";

/**
 * Скелетон вместо тела формы во время первой загрузки данных.
 * Цель — убрать визуальный эффект "мигания" пустых/disabled полей
 * перед тем, как с сервера придут реальные значения. Показывается
 * только при ПЕРВОЙ загрузке: если форма уже была успешно загружена,
 * последующие reload-ы используют обычный disabled-режим, чтобы
 * пользователь видел изменяющиеся данные, а не скелетон.
 */
const FormSkeleton: FC = () => (
  <div className={skeletonStyles.SkeletonRoot} aria-busy="true" aria-label={translate("loadingForm")}>
    <div className={skeletonStyles.SkeletonRow}>
      <div className={`${skeletonStyles.SkeletonField} ${skeletonStyles.SkeletonFieldNarrow}`} />
      <div className={`${skeletonStyles.SkeletonField} ${skeletonStyles.SkeletonFieldNarrow}`} />
    </div>
    <div className={skeletonStyles.SkeletonRow}>
      <div className={`${skeletonStyles.SkeletonField} ${skeletonStyles.SkeletonFieldWide}`} />
    </div>
    <div className={skeletonStyles.SkeletonRow}>
      <div className={skeletonStyles.SkeletonField} />
      <div className={skeletonStyles.SkeletonField} />
    </div>
    <div className={skeletonStyles.SkeletonRow}>
      <div className={`${skeletonStyles.SkeletonField} ${skeletonStyles.SkeletonFieldWide}`} />
    </div>
    <div className={skeletonStyles.SkeletonRow}>
      <div className={skeletonStyles.SkeletonField} />
    </div>
  </div>
);

/**
 * Универсальная обёртка формы модели.
 * Заменяет одинаковый JSX-шаблон во всех формах:
 * ```
 * <div className={styles.FormWrapper}>
 *   <FormPanel ... />
 *   <FormError ... />
 *   <div className={styles.FormBody}>
 *     <Tabs tabs={tabs} />
 *   </div>
 * </div>
 * ```
 */

interface ModelFormProps {
  /** Табы формы */
  tabs: { id: string; label: string; component: ReactNode }[];
  /** Обработчики действий */
  onSave: () => void;
  onSaveAndClose: () => void;
  onClose: () => void;
  onReload?: () => void;
  /** Состояние */
  isLoading: boolean;
  /** true пока ПЕРВАЯ загрузка серверных данных не завершена.
   *  При true вместо реального тела формы рендерится скелетон,
   *  чтобы убрать "мигание" пустых/disabled полей при открытии формы
   *  существующей записи. Передавайте `form.isInitialLoading` из useFormStore. */
  isInitialLoading?: boolean;
  // showReload: boolean;
  /** Только чтение (опционально) */
  readonly?: boolean;
  /** uniqId панели для регистрации тулбара */
  paneId?: string;
  /** endpoint + uuid записи → кнопка «Показать в списке» в шапке панели
   *  (для справочников; в формах документов кнопка добавляется вручную). */
  endpoint?: string;
  recordUuid?: string;
}

const ModelForm: FC<ModelFormProps> = ({
  tabs,
  onSave,
  onSaveAndClose,
  onClose, // закрытие теперь через ✕ в PaneHeaderControls
  onReload,
  isLoading,
  isInitialLoading,
  // showReload,
  readonly,
  paneId,
  endpoint,
  recordUuid,
}) => {
  // Рендерим кнопки формы в заголовок панели через портал
  const toolbarPortal = usePaneToolbar(
    paneId,
    <FormPanel
      onSaveAndClose={onSaveAndClose}
      onSave={onSave}
      // onReload={onReload}
      onClose={onClose}
      readonly={readonly}
      isLoading={isLoading}
    // showReload={showReload}
    />,
  );

  // «Показать в списке» в шапке панели — для справочников (опционально, если
  // переданы endpoint + uuid сохранённой записи). Формы документов добавляют
  // эту кнопку самостоятельно вместе с прочими действиями.
  const headerActionsPortal = usePaneHeaderActions(
    paneId,
    endpoint && recordUuid ? <ShowInJournalButton endpoint={endpoint} uuid={recordUuid} /> : null,
  );

  // ── Skeleton для первой загрузки ─────────────────────────────────────
  // Если форма открывается на существующую запись и серверные данные ещё
  // не пришли (isInitialLoading=true), показываем скелетон вместо реального
  // тела формы — это убирает визуальный эффект мигания пустых/disabled полей.
  // Для новых записей и для последующих reload-ов скелетон не показывается.
  // Прежнее поведение (без скелетона) сохраняется, если форма не передаёт
  // isInitialLoading — fallback на ref-эвристику по isLoading.
  const hasLoadedOnceRef = useRef<boolean>(!isLoading);
  if (!isLoading) hasLoadedOnceRef.current = true;
  const showSkeleton = isInitialLoading !== undefined
    ? isInitialLoading
    : (isLoading && !hasLoadedOnceRef.current);

  return (
    <>
      {showSkeleton ? <FormSkeleton /> : <Tabs tabs={tabs} />}
      {toolbarPortal}
      {headerActionsPortal}
    </>
  );
};

ModelForm.displayName = "ModelForm";
export default ModelForm;
