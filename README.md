# Book Framework

CLI/npm-пакет и спецификация репозитория для написания, редактуры, документирования и сборки одной книги или рассказа.

## Основной принцип

**Одна книга = один Git-репозиторий.**

`@nedobylskiy/book-framework` устанавливается как зависимость в книжный репозиторий и предоставляет CLI `book`. Сам книжный репозиторий хранит только контент, конфиг и документацию; сборочные скрипты не копируются между книгами.

## Установка

Пока пакет не опубликован в npm registry, его можно установить напрямую из GitHub:

```sh
npm install --save-dev github:nedobylskiy/book-framework
```

После публикации пакет можно будет устанавливать обычным способом:

```sh
npm install --save-dev @nedobylskiy/book-framework
```

## Команды CLI

```sh
npx book validate
npx book build
npx book build --format txt
npx book build --format fb2
npx book new-chapter forest-meeting --title "Встреча в лесу"
```

CLI всегда работает с **текущим каталогом**. Поэтому команды запускаются из корня конкретного книжного репозитория, где лежит `book.config.json`.

Удобно добавить команды в `package.json` книги:

```json
{
  "private": true,
  "scripts": {
    "build": "book build",
    "validate": "book validate",
    "chapter": "book new-chapter"
  },
  "devDependencies": {
    "@nedobylskiy/book-framework": "github:nedobylskiy/book-framework"
  }
}
```

Тогда доступны:

```sh
npm run validate
npm run build
npm run chapter -- forest-meeting --title "Встреча в лесу"
```

## Структура книжного репозитория

```text
my-book/
├── README.md
├── package.json
├── book.config.json
├── manuscript/
│   ├── chapters/
│   │   ├── 01-prologue.txt
│   │   ├── 02-first-chapter.txt
│   │   └── ...
│   └── edited/
│       ├── EDITING_RULES.md
│       ├── 01-prologue.txt
│       ├── 02-first-chapter.txt
│       └── ...
├── docs/
│   ├── characters.md
│   ├── world.md
│   ├── organizations.md
│   ├── locations.md
│   ├── technology.md
│   ├── plot.md
│   ├── timeline.md
│   └── continuity.md
└── dist/
```

## Имена и порядок глав

Файл каждой главы **обязательно начинается с её порядкового номера**.

Формат:

```text
NN-slug.txt
```

Примеры:

```text
01-prologue.txt
02-robocafe.txt
03-chase.txt
10-old-cyborg.txt
```

Требования:

- номер начинается минимум с двух цифр: `01`, `02`, ...;
- после номера ставится `-`;
- далее используется короткий латинский slug;
- редакторская версия главы имеет то же имя, что и оригинал;
- порядок глав в `book.config.json` должен совпадать с номерами файлов;
- номера не могут дублироваться.

`book validate` и `book build` проверяют это автоматически.

### Создание главы

Не нужно вручную вычислять следующий номер:

```sh
book new-chapter old-cyborg --title "Старый Киборг"
```

Если в книге уже 9 глав, команда создаст:

```text
manuscript/chapters/10-old-cyborg.txt
manuscript/edited/10-old-cyborg.txt
```

и автоматически добавит запись в `chapters` файла `book.config.json`.

## Жизненный цикл текста

1. Новая глава создаётся через `book new-chapter` либо вручную в `manuscript/chapters/`.
2. Файл в `chapters/` считается авторским оригиналом.
3. Редакторская версия находится в `manuscript/edited/` с тем же именем.
4. Правила редактуры конкретного произведения фиксируются в `manuscript/edited/EDITING_RULES.md`.
5. Факты мира, персонажей, сюжета и хронологии поддерживаются в `docs/`.
6. `book validate` проверяет структуру.
7. `book build` создаёт готовые файлы книги в `dist/`.

## Правила редактуры

`manuscript/edited/EDITING_RULES.md` — обязательный проектный файл. В него записываются правила, которые редактор или ИИ должен соблюдать для конкретного произведения: авторский голос, допустимая степень переписывания, оформление диалогов, юмор, терминология, имена, POV, темп, особенности мира и запрещённые изменения.

Правила конкретной книги имеют приоритет над общими рекомендациями фреймворка.

## Формат book.config.json

```json
{
  "id": "my-book",
  "title": "Название книги",
  "annotation": "Короткая аннотация произведения.",
  "status": "draft",
  "author": {
    "firstName": "Имя",
    "lastName": "Фамилия"
  },
  "language": "ru",
  "buildSource": "edited",
  "outputBaseName": "my-book",
  "genres": ["prose"],
  "chapters": [
    {
      "title": "Пролог",
      "file": "01-prologue.txt"
    },
    {
      "title": "Первая глава",
      "file": "02-first-chapter.txt"
    }
  ]
}
```

`buildSource` принимает `original` или `edited` и определяет, из какой версии рукописи производится сборка.

## Документация мира

`docs/` — внутренняя энциклопедия произведения. Рекомендуются:

- `characters.md` — персонажи;
- `world.md` — устройство мира;
- `organizations.md` — компании, государства и группировки;
- `locations.md` — места;
- `technology.md` — технологии, магия и другие системы;
- `plot.md` — сюжет и арки;
- `timeline.md` — хронология;
- `continuity.md` — факты канона, которые особенно важно не нарушать.

Набор документов можно расширять.

## Сборка

```sh
book build
```

Создаёт TXT и FB2 в `dist/`.

Только один формат:

```sh
book build --format txt
book build --format fb2
```

## Валидация

```sh
book validate
```

Проверяет `book.config.json`, последовательность нумерации глав, формат имён и наличие файлов выбранного `buildSource`.

## Архитектура

Код фреймворка находится только в npm-пакете. Книжные репозитории не содержат `scripts/build.mjs` или других копий сборщика. Это позволяет обновить поддержку FB2, добавить EPUB/PDF или изменить правила валидации одной новой версией пакета для всех книг.
