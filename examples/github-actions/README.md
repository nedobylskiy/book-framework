# GitHub Actions для книжного репозитория

Эти файлы — готовые примеры workflow для книги, которая использует `@nedobylskiy/book-framework` как npm-зависимость.

Скопируйте нужный файл в книжный репозиторий:

```text
.github/workflows/build.yml
.github/workflows/release.yml
```

## build.yml

Запускается:

- вручную через `workflow_dispatch`;
- при push в `main`, если изменились конфиг, рукопись, assets, docs или npm-зависимости.

Workflow:

1. устанавливает Node.js;
2. выполняет `npm ci`;
3. запускает `book validate`;
4. собирает TXT/FB2 через `book build`;
5. собирает отдельные FB2 глав через `book build-chapters`;
6. сохраняет весь `dist/` как GitHub Actions artifact.

Готовый artifact можно скачать со страницы конкретного workflow run.

## release.yml

Запускается вручную либо при push тега вида:

```sh
git tag v1.0.0
git push origin v1.0.0
```

При запуске по тегу workflow собирает книгу и создаёт GitHub Release с автоматически сгенерированными release notes. Файлы из `dist/` и `dist/chapters/` прикладываются к релизу.

Для создания Release используется установленный на GitHub-hosted runner `gh` CLI и стандартный `GITHUB_TOKEN`; отдельный секрет не нужен. Workflow поэтому содержит:

```yaml
permissions:
  contents: write
```

## package-lock.json

Примеры используют `npm ci`, поэтому в книжном репозитории рекомендуется коммитить `package-lock.json`. Это делает CI-сборку воспроизводимой и фиксирует конкретные версии framework и universe-пакета.

Если проект принципиально не хранит lockfile, замените:

```yaml
run: npm ci
```

на:

```yaml
run: npm install
```

## Приватные universe/framework зависимости

Если npm-зависимость устанавливается из приватного GitHub-репозитория, стандартного checkout текущей книги может быть недостаточно для доступа npm к другому приватному репозиторию. В таком случае настройте отдельный token/SSH deploy key либо публикуйте пакет в package registry.

Для публичных GitHub-зависимостей дополнительная настройка не требуется.
