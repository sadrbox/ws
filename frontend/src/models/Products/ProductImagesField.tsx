// Блок «Изображения товара» — до 4 фото с пометкой «Главное».
// Хранятся как AttachedFile (ownerType="product"); «главное» — поле comment="main".
// API: GET/POST/DELETE /files, PATCH /files/:uuid {isMain}. Картинки тянем blob'ом
// через авторизованный apiClient (img src=objectURL). Без inline-стилей.
import { FC, useCallback, useEffect, useRef, useState } from "react";
import apiClient from "src/services/api/client";
import { translate } from "src/i18";
import { logger } from "src/utils/logger";
import { LoadingSpinner } from "src/components/UI";
import ProgressSpinner from "src/components/ProgressSpinner";
import styles from "./ProductImagesField.module.scss";

const MAX_IMAGES = 4;
const MAX_SIZE = 5 * 1024 * 1024; // 5 МБ
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const ACCEPT_ATTR = ACCEPT.join(",");

interface ImgFile {
  uuid: string;
  fileName: string;
  mimeType?: string | null;
  comment?: string | null;
  uploadedAt?: string | null;
}

type Pending =
  | { status: "uploading"; progress: number }
  | { status: "error"; message: string }
  | null;

const isMain = (f: ImgFile) => f.comment === "main";

// ── Иконки (SVG-разметка, не стили) ──────────────────────────────────────────
const IconPlus = () => (
  <svg className={styles.Plus} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);
const IconEye = () => (
  <svg className={styles.OverlayIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
);
const IconTrash = () => (
  <svg className={styles.OverlayIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
);
const IconClose = () => (
  <svg className={styles.CloseIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IconAlert = () => (
  <svg className={styles.ErrorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
);

interface ProductImagesFieldProps {
  productUuid?: string;
  disabled?: boolean;
}

/** Длинная сторона миниатюры, px. Превью в карточке крупнее не нужно. */
const THUMB_SIZE = 240;

/**
 * Уменьшенная копия изображения (JPEG). null — браузер не смог декодировать файл
 * (тогда просто не шлём миниатюру, сервер отдаст оригинал).
 */
async function makeThumbnail(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72),
    );
  } catch {
    return null; // не картинка / формат не поддержан браузером
  }
}

const ProductImagesField: FC<ProductImagesFieldProps> = ({ productUuid, disabled }) => {
  const [images, setImages] = useState<ImgFile[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const urlsRef = useRef<Record<string, string>>({});
  // Оригиналы (грузятся по клику «Посмотреть») — отдельно от миниатюр.
  const fullUrlsRef = useRef<Record<string, string>>({});

  const ready = !!productUuid && !disabled;

  // Превью — МИНИАТЮРА, а не оригинал: карточка товара иначе качает полноразмерные фото
  // (мегабайты на каждое). У файлов, загруженных до этой правки, миниатюры нет — бэкенд
  // в этом случае отдаёт оригинал (см. GET /files/thumb/:uuid).
  const ensurePreview = useCallback(async (uuid: string) => {
    if (urlsRef.current[uuid]) return;
    try {
      const res = await apiClient.get(`/files/thumb/${uuid}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      urlsRef.current[uuid] = url;
      setPreviews((p) => ({ ...p, [uuid]: url }));
    } catch (e) {
      logger.warn("[ProductImages] preview load failed", uuid, e);
    }
  }, []);

  const loadImages = useCallback(async () => {
    if (!productUuid) { setImages([]); return; }
    try {
      const res = await apiClient.get("/files", { params: { ownerType: "product", ownerUuid: productUuid } });
      const all: ImgFile[] = (res.data?.items ?? []).filter((f: ImgFile) => (f.mimeType ?? "").startsWith("image/"));
      // главное фото — первым, остальные по времени загрузки (стабильный порядок)
      all.sort((a, b) => {
        if (isMain(a) !== isMain(b)) return isMain(a) ? -1 : 1;
        return String(a.uploadedAt ?? "").localeCompare(String(b.uploadedAt ?? ""));
      });
      setImages(all);
      all.forEach((f) => void ensurePreview(f.uuid));
    } catch (e) {
      logger.warn("[ProductImages] list failed", e);
    }
  }, [productUuid, ensurePreview]);

  useEffect(() => { void loadImages(); }, [loadImages]);

  // Освобождаем objectURL при размонтировании.
  useEffect(() => () => {
    Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    Object.values(fullUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = {};
    fullUrlsRef.current = {};
  }, []);

  const validate = (file: File): string | null => {
    if (!ACCEPT.includes(file.type)) return translate("imgInvalidFormat");
    if (file.size > MAX_SIZE) return translate("imgTooLarge");
    return null;
  };

  const upload = useCallback(async (file: File) => {
    if (!productUuid) return;
    const fd = new FormData();
    fd.append("file", file);
    // Миниатюру делает КЛИЕНТ (canvas) и шлёт вместе с оригиналом: так серверу не нужен
    // нативный ресайзер (sharp — лишняя нативная зависимость на Alpine), а превью
    // весит килобайты. Не получилось (экзотический формат) — не беда: сервер отдаст
    // оригинал.
    const thumb = await makeThumbnail(file);
    if (thumb) fd.append("thumbnail", thumb, "thumb.jpg");
    fd.append("ownerType", "product");
    fd.append("ownerUuid", productUuid);
    // Первое изображение автоматически становится главным.
    fd.append("comment", images.length === 0 ? "main" : "");
    setPending({ status: "uploading", progress: 0 });
    try {
      await apiClient.post("/files", fd, {
        onUploadProgress: (ev) => {
          const total = ev.total ?? file.size;
          const pct = total ? Math.round((ev.loaded / total) * 100) : 0;
          setPending({ status: "uploading", progress: pct });
        },
      });
      setPending(null);
      await loadImages();
    } catch (e) {
      logger.warn("[ProductImages] upload failed", e);
      setPending({ status: "error", message: translate("imgUploadFailed") });
    }
  }, [productUuid, images.length, loadImages]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!ready || !files || files.length === 0) return;
    if (images.length >= MAX_IMAGES) return;
    const file = files[0];
    const err = validate(file);
    if (err) { setPending({ status: "error", message: err }); return; }
    void upload(file);
  }, [ready, images.length, upload]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = ""; // позволяем повторно выбрать тот же файл
  };

  const handleDelete = useCallback(async (f: ImgFile) => {
    if (!window.confirm(translate("imgDeleteConfirm"))) return;
    try {
      await apiClient.delete(`/files/${f.uuid}`);
      const url = urlsRef.current[f.uuid];
      if (url) { URL.revokeObjectURL(url); delete urlsRef.current[f.uuid]; }
      // если удалили главное — назначим главным первое из оставшихся
      const rest = images.filter((x) => x.uuid !== f.uuid);
      if (isMain(f) && rest.length > 0) {
        try { await apiClient.patch(`/files/${rest[0].uuid}`, { isMain: true }); } catch { /* ignore */ }
      }
      await loadImages();
    } catch (e) {
      logger.warn("[ProductImages] delete failed", e);
    }
  }, [images, loadImages]);

  const setMain = useCallback(async (f: ImgFile) => {
    if (isMain(f)) return;
    try {
      await apiClient.patch(`/files/${f.uuid}`, { isMain: true });
      await loadImages();
    } catch (e) {
      logger.warn("[ProductImages] set main failed", e);
    }
  }, [loadImages]);

  // Просмотр — ОРИГИНАЛ, и он тянется только сейчас, по клику. В сетке показывается
  // миниатюра (килобайты), полноразмерное фото сервер отдаёт лишь тогда, когда его
  // действительно захотели увидеть. Открывать здесь previews[uuid] нельзя: это
  // миниатюра 240px — пользователь увидел бы мыло вместо оригинала.
  const view = useCallback(async (f: ImgFile) => {
    const cached = fullUrlsRef.current[f.uuid];
    if (cached) { window.open(cached, "_blank", "noopener"); return; }
    try {
      const res = await apiClient.get(`/files/download/${f.uuid}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      fullUrlsRef.current[f.uuid] = url;
      window.open(url, "_blank", "noopener");
    } catch (e) {
      logger.warn("[ProductImages] full image load failed", f.uuid, e);
    }
  }, []);

  // ── Сборка 4 слотов ──────────────────────────────────────────────────────
  const slots: React.ReactNode[] = [];
  for (let i = 0; i < MAX_IMAGES; i++) {
    if (i < images.length) {
      const f = images[i];
      const previewReady = !!previews[f.uuid];
      slots.push(
        <div key={f.uuid} className={`${styles.Slot} ${styles.Filled}`}>
          {!previewReady ? (
            // Спиннер, пока подгружается blob-превью изображения.
            <LoadingSpinner />
          ) : (
            <>
              <img className={styles.Img} src={previews[f.uuid]} alt={f.fileName} />
              {isMain(f) && <span className={styles.MainBadge}>{translate("imgMainPhoto")}</span>}
              {!isMain(f) && ready && (
                <button type="button" className={styles.MainToggle} title={translate("imgSetMain")} onClick={() => void setMain(f)} />
              )}
              {isMain(f) && (
                <span className={`${styles.MainToggle} ${styles.MainToggleOn}`}><span className={styles.MainDot} /></span>
              )}
              <div className={styles.Overlay}>
                <button type="button" className={styles.OverlayBtn} title={translate("view")} onClick={() => void view(f)}><IconEye /></button>
                {ready && (
                  <button type="button" className={`${styles.OverlayBtn} ${styles.OverlayBtnDanger}`} title={translate("delete")} onClick={() => void handleDelete(f)}><IconTrash /></button>
                )}
              </div>
            </>
          )}
        </div>,
      );
    } else if (i === images.length && pending?.status === "uploading") {
      slots.push(
        <div key="uploading" className={`${styles.Slot} ${styles.Loading}`}>
          <div className={styles.ProgressWrap}>
            <ProgressSpinner value={pending.progress} />
          </div>
        </div>,
      );
    } else if (i === images.length && pending?.status === "error") {
      slots.push(
        <div key="error" className={`${styles.Slot} ${styles.ErrorSlot}`}>
          <button type="button" className={styles.CloseBtn} title={translate("close")} onClick={() => setPending(null)}><IconClose /></button>
          <IconAlert />
          <span className={styles.ErrorTitle}>{pending.message}</span>
          <span className={styles.ErrorSub}>{translate("imgFormatsShort")}</span>
        </div>,
      );
    } else {
      const idx = i;
      const empties = ready;
      slots.push(
        <div
          key={`empty-${i}`}
          className={`${styles.Slot} ${styles.Add} ${!empties ? styles.Disabled : ""} ${dragSlot === idx ? styles.DragOver : ""}`}
          onClick={() => { if (empties) inputRef.current?.click(); }}
          onDragOver={(e) => { if (empties) { e.preventDefault(); setDragSlot(idx); } }}
          onDragLeave={() => setDragSlot((s) => (s === idx ? null : s))}
          onDrop={(e) => { e.preventDefault(); setDragSlot(null); handleFiles(e.dataTransfer.files); }}
        >
          <IconPlus />
          <span className={styles.AddHint}>{translate("imgAddPhoto")}</span>
        </div>,
      );
    }
  }

  return (
    <div className={styles.Block}>
      <span className={styles.Label}>{translate("imgProductImages")}</span>
      <div className={styles.Row}>{slots}</div>
      <input ref={inputRef} type="file" accept={ACCEPT_ATTR} className={styles.HiddenInput} onChange={onInputChange} />
      <div className={styles.Hint}>
        {ready ? translate("imgHint") : translate("imgSaveFirst")}
      </div>
    </div>
  );
};

ProductImagesField.displayName = "ProductImagesField";
export default ProductImagesField;
