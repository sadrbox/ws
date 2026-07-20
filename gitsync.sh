#!/bin/bash
#
# Синхронизация репозитория: подтянуть → закоммитить → отправить.
# Поддерживает режим компиляции через флаг --compile (-c)

set -u

REMOTE="origin"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" = "HEAD" ]; then
	echo "❌ Detached HEAD — сначала переключитесь на ветку: git switch <branch>"
	exit 1
fi

cd "$(git rev-parse --show-toplevel)" || { echo "❌ Не git-репозиторий"; exit 1; }

# Разбираем аргументы скрипта
COMPILE_MODE=false
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		-c|--compile)
			COMPILE_MODE=true
			shift
			;;
		*)
			COMMIT_MSG="$1"
			shift
			;;
	esac
done

echo "🔄 Ветка: $BRANCH | Режим: $( $COMPILE_MODE && echo "🚀 КОМПИЛЯЦИЯ" || echo "💻 РАЗРАБОТКА" )"

# ── ФУНКЦИЯ ДЛЯ ПРОВЕРКИ БОЛЬШИХ ФАЙЛОВ ──────────────────────────────────────
check_large_files() {
	LIMIT=$((50 * 1024 * 1024))
	LARGE_FILES=$(git diff --cached --name-only -z | xargs -0 -I{} sh -c \
		'[ -f "{}" ] && [ "$(stat -c%s "{}" 2>/dev/null || echo 0)" -gt '"$LIMIT"' ] && echo "{}"')

	if [ -n "$LARGE_FILES" ]; then
		echo "⚠️  Файлы больше 50 МБ (GitHub отклонит push):"
		echo "$LARGE_FILES" | sed 's/^/     /'
		echo "   Используйте Git LFS (git lfs track '*.zip') или .gitignore."
		if [ -t 0 ]; then
			printf "   Продолжить всё равно? (y/N) "
			read -r choice
			case "$choice" in
				[Yy]*) ;;
				*) echo "⏹️  Остановлено."; git reset >/dev/null; exit 1 ;;
			esac
		else
			echo "⏹️  Остановлено (неинтерактивный запуск)."
			git reset >/dev/null
			exit 1
		fi
	fi
}

# ── РЕЖИМ 1: КОМПИЛЯЦИЯ (--compile) ──────────────────────────────────────────
if [ "$COMPILE_MODE" = true ]; then
	HAS_CHANGES=false
	if [ -n "$(git status --porcelain)" ]; then
		HAS_CHANGES=true
		echo "📦 Сохраняем локальные правки компиляции в stash..."
		git stash push -m "gitsync-compile-stash" >/dev/null
	fi

	echo "📥 Получаем свежий код с сервера..."
	git fetch "$REMOTE" "$BRANCH"
	
	# Сбрасываем ветку строго на состояние origin/ветка (без rebase-конфликтов)
	if ! git reset --hard "$REMOTE/$BRANCH"; then
		echo "❌ Не удалось обновить ветку до состояния сервера."
		[ "$HAS_CHANGES" = true ] && git stash pop >/dev/null && echo "🩹 Локальные правки возвращены."
		exit 1
	fi

	if [ "$HAS_CHANGES" = true ]; then
		echo "🩹 Возвращаем локальные правки компиляции..."
		if ! git stash pop >/dev/null; then
			echo "⚠️  Внимание: возникли конфликты при возврате локальных правок компиляции."
			echo "   Они сохранены в git stash. Разрешите их вручную."
		fi
	fi
	
	echo "✅ Репозиторий обновлен и готов к сборке!"
	git status -sb | head -1
	exit 0
fi

# ── РЕЖИМ 2: РАЗРАБОТКА (Обычный запуск) ──────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
	git status -s
	echo "✏️  Есть изменения — коммитим."

	git add -A
	check_large_files

	git commit -m "${COMMIT_MSG:-Auto commit: $(date +'%Y-%m-%d %H:%M:%S')}" \
		|| { echo "❌ Ошибка при коммите"; exit 1; }
else
	echo "✅ Локальных изменений нет."
fi

# Подтягиваем удаленные изменения
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
	if ! git pull --rebase "$REMOTE" "$BRANCH"; then
		echo "❌ Конфликт при pull --rebase. Разрешите его, затем:"
		echo "   git rebase --continue    (или git rebase --abort — откатиться)"
		exit 1
	fi
else
	echo "ℹ️  Ветки $BRANCH на $REMOTE ещё нет — будет создана при push."
fi

# Отправляем на сервер
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1 \
	&& [ -z "$(git log "$REMOTE/$BRANCH..$BRANCH" --oneline 2>/dev/null)" ]; then
	echo "✅ Уже синхронизировано — отправлять нечего."
else
	echo "🚀 Push $BRANCH → $REMOTE/$BRANCH..."
	if git push -u "$REMOTE" "$BRANCH"; then
		AHEAD=$(git log "$REMOTE/$BRANCH..$BRANCH" --oneline | wc -l)
		if [ "$AHEAD" -eq 0 ]; then
			echo "✅ Push успешен: $REMOTE/$BRANCH = $(git rev-parse --short HEAD)"
		else
			echo "❌ Push прошёл, но $AHEAD коммит(ов) всё ещё не на сервере."
			exit 1
		fi
	else
		echo "❌ Push провалился. Проверьте доступ/лимиты GitHub или используйте LFS."
		exit 1
	fi
fi

git status -sb | head -1