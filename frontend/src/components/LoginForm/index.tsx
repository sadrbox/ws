import React, { useState, useCallback, useEffect, useRef } from "react";
import { login } from "src/services/auth";
import styles from "./LoginForm.module.scss";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError("Введите имя пользователя");
        return;
      }

      setIsLoading(true);
      try {
        const result = await login(trimmedUsername, password || undefined);
        if (result.success) {
          onLoginSuccess();
        } else {
          setError(result.message || "Ошибка авторизации");
        }
      } catch {
        setError("Ошибка соединения с сервером");
      } finally {
        setIsLoading(false);
      }
    },
    [username, password, onLoginSuccess]
  );

  return (
    <div className={styles.LoginOverlay}>
      <form className={styles.LoginForm} onSubmit={handleSubmit}>
        <h2 className={styles.title}>Вход в систему</h2>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.field}>
          <label htmlFor="login_username">Имя пользователя</label>
          <input
            ref={usernameRef}
            id="login_username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            placeholder="Введите имя пользователя"
            autoComplete="username"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="login_password">Пароль</label>
          <input
            id="login_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            placeholder="Введите пароль (если задан)"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={isLoading}
        >
          {isLoading ? "Вход..." : "Войти"}
        </button>
      </form>
    </div>
  );
};

export default LoginForm;
