import { FC, useCallback, useEffect, useRef, useState } from "react";
import apiClient from "src/services/api/client";
import styles from "./AvatarUpload.module.scss";

interface AvatarUploadProps {
  /** REST-эндпоинт модели (employees, users, contactpersons) */
  endpoint: string;
  /** UUID сущности */
  entityUuid: string;
  /** Есть ли avatarPath у сущности (для первичной загрузки) */
  hasAvatar: boolean;
  /** Размер аватара в px (по умолчанию 128, будет масштабироваться адаптивно) */
  size?: number;
  /** Отключить интерактивность */
  disabled?: boolean;
}

const AvatarUpload: FC<AvatarUploadProps> = ({
  endpoint,
  entityUuid,
  hasAvatar,
  size = 128,
  disabled = false,
}) => {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Освобождаем blob URL при размонтировании
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Загрузка аватара при монтировании / смене uuid
  const loadAvatar = useCallback(async () => {
    if (!entityUuid) return;
    try {
      const res = await apiClient.get(`/${endpoint}/${entityUuid}/avatar`, {
        responseType: "blob",
      });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(res.data);
      blobUrlRef.current = url;
      setAvatarUrl(url);
    } catch {
      setAvatarUrl(null);
    }
  }, [endpoint, entityUuid]);

  useEffect(() => {
    if (hasAvatar && entityUuid) loadAvatar();
    else setAvatarUrl(null);
  }, [hasAvatar, entityUuid, loadAvatar]);

  // Загрузка файла
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !entityUuid || disabled) return;
      setIsUploading(true);
      try {
        const fd = new FormData();
        fd.append("avatar", file);
        await apiClient.post(`/${endpoint}/${entityUuid}/avatar`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        await loadAvatar();
      } catch (err) {
        console.error("[AvatarUpload] upload error:", err);
      } finally {
        setIsUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [endpoint, entityUuid, disabled, loadAvatar]
  );

  // Удаление аватара
  const handleDelete = useCallback(async () => {
    if (!entityUuid || disabled) return;
    try {
      await apiClient.delete(`/${endpoint}/${entityUuid}/avatar`);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setAvatarUrl(null);
    } catch (err) {
      console.error("[AvatarUpload] delete error:", err);
    }
  }, [endpoint, entityUuid, disabled]);

  return (
    <div className={styles.AvatarUploadRoot}>
      <div
        className={[styles.AvatarCircle, disabled && styles.disabled].filter(Boolean).join(" ")}
        style={{ "--avatar-size": `${size}px` } as React.CSSProperties}
        onClick={disabled ? undefined : () => inputRef.current?.click()}
        title={disabled ? undefined : "Нажмите для загрузки фото"}
      >
        {isUploading ? (
          <span className={styles.AvatarSpinner} />
        ) : avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Аватар"
            className={styles.AvatarImage}
            onError={() => setAvatarUrl(null)}
          />
        ) : (
          <span className={styles.AvatarPlaceholder}>👤</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.AvatarInput}
        onChange={handleUpload}
        disabled={disabled}
      />

      {!disabled && (
        <div className={styles.AvatarActions}>
          <button
            type="button"
            className={styles.AvatarBtn}
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            Загрузить
          </button>
          {avatarUrl && (
            <button
              type="button"
              className={[styles.AvatarBtn, styles.AvatarBtnDanger].join(" ")}
              onClick={handleDelete}
              disabled={isUploading}
            >
              Удалить
            </button>
          )}
        </div>
      )}
    </div>
  );
};

AvatarUpload.displayName = "AvatarUpload";
export default AvatarUpload;
