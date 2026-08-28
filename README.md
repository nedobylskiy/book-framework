# Book Framework

CLI/npm-пакет и спецификация репозитория для написания, редактуры, документирования и сборки одной книги или рассказа.

## Основной принцип

**Одна книга = один Git-репозиторий.**

`@nedobylskiy/book-framework` устанавливается как зависимость в книжный репозиторий и предоставляет CLI `book`. Сам книжный репозиторий хранит контент, конфиг и документацию; сборочные скрипты между книгами не копируются.

## Установка

Пока пакет не опубликован в npm registry:

```sh
npm install --save-dev github:nedobylskiy/book-framework
```

После публикации:

```sh
npm install --save-dev @nedobylskiy/book-framework
```

## Команды CLI

```sh
npx book validate
npx book universe
npx book build
npx book build --format txt
npx book build --format fb2
npx book build-chapters
npx book build --format fb2 --chapters
npx book new-chapter forest-meeting --title "Встреча в лесу"
```

CLI всегда работает с текущим каталогом книги, где лежит `book.config.json`.

Удобный `package.json` книги:

```json
{
  "private": true,
  "scripts": {
    "build": "book build",
    "build:chapters": "book build-chapters",
    "validate": "book validate",
    "chapter": "book new-chapter"
  },
  "devDependencies": {
    "@nedobylskiy/book-framework": "github:nedobylskiy/book-framework",
    "@my-scope/my-universe": "github:owner/my-universe"
  }
}
```

## Структура книжного репозитория

```text
my-book/
├── README.md
├── package.json
├── book.config.json
├── assets/
│   └── cover.jpg
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
    ├── my-book.txt
    ├── my-book.fb2
    └── chapters/
        ├── 01-prologue.fb2
        └── 02-first-chapter.fb2
```

## Имена и порядок глав

Каждый файл главы обязательно начинается с порядкового номера:

```text
NN-slug.txt
```

Например:

```text
01-prologue.txt
02-robocafe.txt
03-chase.txt
10-old-cyborg.txt
```

Порядок в `book.config.json` обязан совпадать с номерами файлов. Оригинальная и редакторская версии используют одинаковые имена. `book validate` и `book build` проверяют это автоматически.

### Создание главы

```sh
book new-chapter old-cyborg --title "Старый Киборг"
```

Если уже существует 9 глав, будут созданы:

```text
manuscript/chapters/10-old-cyborg.txt
manuscript/edited/10-old-cyborg.txt
```

и новая глава автоматически попадёт в `book.config.json`.

## Жизненный цикл текста

1. Авторский оригинал хранится в `manuscript/chapters/`.
2. Редакторская версия — в `manuscript/edited/` с тем же именем файла.
3. Правила конкретной книги фиксируются в `manuscript/edited/EDITING_RULES.md`.
4. Канон, персонажи, сюжет и устройство мира поддерживаются в `docs/`.
5. `book validate` проверяет структуру.
6. `book build` создаёт публикационные файлы в `dist/`.

## Правила редактуры

`manuscript/edited/EDITING_RULES.md` — обязательный проектный файл. В него записываются авторский голос, допустимая степень переписывания, оформление диалогов, юмор, терминология, имена, POV, темп, особенности мира и запрещённые изменения.

Правила конкретной книги имеют приоритет над общими рекомендациями фреймворка.

## Вселенная как зависимость

Если несколько книг используют один мир, его фундаментальные правила выносятся в отдельный репозиторий и устанавливаются в каждую книгу как npm-пакет. В `book.config.json` книга хранит не копию канона, а явную ссылку на пакет и его главный документ:

```json
{
  "universe": {
    "package": "@my-scope/my-universe",
    "entry": "universe/index.md"
  }
}
```

Установить вселенную напрямую из GitHub можно так:

```sh
npm install --save-dev github:owner/my-universe
```

Имя в `universe.package` должно совпадать с `name` в `package.json` вселенной. `entry` опционален; по умолчанию используется `universe/index.md`.

Перед написанием, редактурой и проверкой конфликтов человек или ИИ обязан прочитать основной документ вселенной и связанные с задачей файлы пакета. Найти установленный основной документ можно командой:

```sh
npx book universe
```

`book validate` также проверяет наличие пакета и указанного файла. Если книга самостоятельная, используйте `"universe": null` или не указывайте поле.

Во вселенную попадают только фундаментальные правила и факты, общие для нескольких произведений. Персонажи конкретной книги, её сюжет, сцены и локальная хронология остаются в `docs/` книжного репозитория. Изменение канона делается в репозитории вселенной, выпускается новой версией и затем обновляется в книгах осознанно.

Готовая спецификация и шаблон пакета: [nedobylskiy/book-universe-framework](https://github.com/nedobylskiy/book-universe-framework).

## Формат book.config.json

Минимальные поля остаются общими для всех форматов, а форматоспецифичные настройки находятся в `formats`.

```json
{
  "id": "my-book",
  "title": "Название книги",
  "annotation": "Короткая аннотация произведения.",
  "status": "draft",
  "author": {
    "firstName": "Имя",
    "middleName": "Отчество",
    "lastName": "Фамилия"
  },
  "language": "ru",
  "buildSource": "edited",
  "outputBaseName": "my-book",
  "genres": ["prose"],
  "universe": {
    "package": "@my-scope/my-universe",
    "entry": "universe/index.md"
  },
  "formats": {
    "txt": {
      "separator": "------------------------------------------------------------------------",
      "lineEnding": "crlf",
      "includeTitlePage": true
    },
    "fb2": {
      "cover": "assets/cover.jpg",
      "genres": ["sf_action", "humor_prose"],
      "keywords": ["приключения", "фантастика"],
      "sequence": {
        "name": "Название цикла",
        "number": 1
      },
      "document": {
        "version": "1.0",
        "author": "Имя редактора или программы"
      },
      "publish": {
        "bookName": "Название издания",
        "publisher": "Издательство",
        "city": "Москва",
        "year": 2026,
        "isbn": "978-0-00-000000-0"
      }
    }
  },
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

Все поля внутри `formats` опциональны. Отсутствие секции `formats` сохраняет прежнее поведение сборщика.

### Общие поля

- `id` — стабильный идентификатор книги;
- `title` — название;
- `annotation` — аннотация;
- `status` — например `idea`, `draft`, `editing`, `finished`, `published`;
- `author` — автор; поддерживаются `firstName`, `middleName`, `lastName`, а для FB2 также `nickname`, `email`, `homePage`;
- `language` — язык;
- `buildSource` — `original` или `edited`;
- `outputBaseName` — базовое имя файлов в `dist/`;
- `genres` — жанры по умолчанию;
- `universe` — опциональная npm-зависимость с общим каноном; `package` задаёт имя пакета, `entry` — главный Markdown-файл внутри него;
- `chapters` — главы в порядке книги.

## Настройки TXT

`formats.txt` поддерживает:

- `separator` — строка между титульной частью и главами, а также между главами. По умолчанию используется 72 символа `=`;
- `lineEnding` — `crlf` по умолчанию или `lf`;
- `includeTitlePage` — включать ли название книги и автора в начале файла, по умолчанию `true`.

Пример минимальной настройки:

```json
{
  "formats": {
    "txt": {
      "separator": "***"
    }
  }
}
```

## Настройки FB2

`formats.fb2` поддерживает:

- `cover` — путь относительно корня книги к `.jpg`, `.jpeg` или `.png`; файл встраивается внутрь FB2 как `<binary>`;
- `genres` — FB2-жанры именно для этого формата; если не указаны, используются общие `genres`;
- `keywords` — ключевые слова;
- `sequence.name` и `sequence.number` — книжный цикл и номер в нём;
- `document.id` — базовый ID документа; для отдельных глав на его основе генерируются уникальные ID;
- `document.version` — версия FB2-документа, по умолчанию `1.0`;
- `document.date` — дата документа в `YYYY-MM-DD`; по умолчанию текущая дата сборки;
- `document.author` — автор/редактор электронной версии;
- `publish.bookName` — название конкретного издания;
- `publish.publisher` — издательство;
- `publish.city` — город издания;
- `publish.year` — год;
- `publish.isbn` — ISBN.

Общие `title`, `annotation`, `author` и `language` автоматически попадают в FB2 metadata.

## Сборка

```sh
book build
```

Создаёт TXT и FB2 в `dist/`.

```sh
book build --format txt
book build --format fb2
```

### Отдельный FB2 для каждой главы

Для публикационных платформ, куда главы загружаются по одной:

```sh
book build-chapters
```

Эквивалентная команда:

```sh
book build --format fb2 --chapters
```

Результат:

```text
dist/chapters/01-prologue.fb2
dist/chapters/02-first-chapter.fb2
...
```

Каждый файл содержит ровно одну главу в `<body>` и не добавляет отдельную титульную секцию, поэтому титульная страница не превращается в лишнюю главу при импорте на платформу. FB2 metadata, обложка, жанры, keywords, sequence и publish-info берутся из того же `formats.fb2`. Для каждой главы генерируется собственный стабильный document ID на основе базового ID книги и имени файла главы.

## Валидация

```sh
book validate
```

Проверяет `book.config.json`, последовательность нумерации глав, формат имён и наличие файлов выбранного `buildSource`.

## Архитектура

Код фреймворка находится только в npm-пакете. Книжные репозитории не содержат копий сборщика. Это позволяет добавлять EPUB/PDF и новые настройки форматов одной новой версией пакета для всех книг.
