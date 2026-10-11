import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

export function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

export function authorName(author = {}) {
  return [author.firstName, author.middleName, author.lastName].filter(Boolean).join(' ');
}

export function getBookDir() {
  return process.cwd();
}

export async function loadConfig(bookDir = getBookDir()) {
  return JSON.parse(await readFile(join(bookDir, 'book.config.json'), 'utf8'));
}

export function resolveUniverse(config, bookDir = getBookDir()) {
  if (config.universe == null) return null;
  if (typeof config.universe !== 'object' || Array.isArray(config.universe)) {
    throw new Error('universe должен быть объектом с полями package и entry либо null.');
  }

  const packageName = config.universe.package;
  const entry = config.universe.entry ?? 'universe/index.md';
  const npmPackagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  if (typeof packageName !== 'string' || !npmPackagePattern.test(packageName)) {
    throw new Error('Для universe необходимо указать корректное имя npm-пакета в поле package.');
  }
  if (typeof entry !== 'string' || !entry.trim() || entry.startsWith('/') || entry.startsWith('\\') || entry.split(/[\\/]/).includes('..')) {
    throw new Error('universe.entry должен быть безопасным относительным путём внутри npm-пакета.');
  }

  const requireFromBook = createRequire(join(bookDir, 'package.json'));
  try {
    return {
      package: packageName,
      entry,
      path: requireFromBook.resolve(`${packageName}/${entry}`)
    };
  } catch {
    throw new Error(`Не удалось открыть вселенную ${packageName}/${entry}. Установите пакет и проверьте universe в book.config.json.`);
  }
}

export async function validateBook(bookDir = getBookDir(), { readText = true } = {}) {
  const config = await loadConfig(bookDir);

  if (!config.title || !authorName(config.author)) {
    throw new Error('В book.config.json необходимо указать title и author.');
  }
  if (!Array.isArray(config.chapters) || !config.chapters.length) {
    throw new Error('В book.config.json не указан список chapters.');
  }

  validateFb2Metadata(config);
  validateEpubMetadata(config);
  validateMiddleHtmlMetadata(config);
  validatePdfMetadata(config);

  const universe = resolveUniverse(config, bookDir);

  const sourceKind = config.buildSource ?? 'edited';
  if (!['original', 'edited'].includes(sourceKind)) {
    throw new Error('buildSource должен быть original или edited.');
  }

  const sourceDir = resolve(bookDir, 'manuscript', sourceKind === 'original' ? 'chapters' : 'edited');
  const chapters = [];
  const usedNumbers = new Set();

  for (const [index, chapter] of config.chapters.entries()) {
    if (!chapter.title || !chapter.file) throw new Error('У каждой главы нужны title и file.');

    const match = /^(\d{2,})-[a-z0-9][a-z0-9-]*\.txt$/i.exec(chapter.file);
    if (!match) {
      throw new Error(`Некорректное имя главы: ${chapter.file}. Используйте формат NN-slug.txt, например 01-prologue.txt.`);
    }

    const number = Number(match[1]);
    const expected = index + 1;
    if (number !== expected) {
      throw new Error(`Номер файла ${chapter.file} не совпадает с позицией в chapters: ожидался ${String(expected).padStart(2, '0')}.`);
    }
    if (usedNumbers.has(number)) throw new Error(`Дублирующийся номер главы: ${number}.`);
    usedNumbers.add(number);

    const filePath = resolve(sourceDir, chapter.file);
    if (!filePath.startsWith(sourceDir + sep) && filePath !== sourceDir) {
      throw new Error(`Недопустимый путь главы: ${chapter.file}`);
    }

    const entry = { ...chapter, number };
    if (readText) entry.text = normalizeText(await readFile(filePath, 'utf8'));
    chapters.push(entry);
  }

  return { bookDir, config, chapters, sourceDir, universe };
}

function validateFb2Metadata(config) {
  const settings = config.formats?.fb2 ?? {};
  for (const [field, value] of [['language', settings.language ?? config.language], ['sourceLanguage', settings.sourceLanguage ?? config.sourceLanguage]]) {
    if (value != null && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`${field} должен быть непустой строкой с кодом языка.`);
    }
  }

  if (settings.translators != null && !Array.isArray(settings.translators)) {
    throw new Error('formats.fb2.translators должен быть массивом.');
  }
  for (const [index, translator] of (settings.translators ?? []).entries()) {
    if (!translator || typeof translator !== 'object' || Array.isArray(translator)) {
      throw new Error(`Переводчик ${index + 1} в formats.fb2.translators должен быть объектом.`);
    }
    if (![translator.firstName, translator.middleName, translator.lastName, translator.nickname].some(Boolean)) {
      throw new Error(`У переводчика ${index + 1} укажите имя, фамилию, отчество или nickname.`);
    }
  }
}

function validateEpubMetadata(config) {
  const settings = config.formats?.epub ?? {};
  const language = settings.language ?? config.language;
  if (language != null && (typeof language !== 'string' || !language.trim())) {
    throw new Error('formats.epub.language должен быть непустой строкой с кодом языка.');
  }
  for (const field of ['titlePage', 'tableOfContents']) {
    if (settings[field] != null && typeof settings[field] !== 'boolean') {
      throw new Error(`formats.epub.${field} должен быть true или false.`);
    }
  }
  if (settings.subjects != null && (!Array.isArray(settings.subjects) || settings.subjects.some(subject => typeof subject !== 'string' || !subject.trim()))) {
    throw new Error('formats.epub.subjects должен быть массивом непустых строк.');
  }
  if (settings.translators != null && !Array.isArray(settings.translators)) {
    throw new Error('formats.epub.translators должен быть массивом.');
  }
  for (const [index, translator] of (settings.translators ?? []).entries()) {
    if (!translator || typeof translator !== 'object' || Array.isArray(translator)) {
      throw new Error(`Переводчик ${index + 1} в formats.epub.translators должен быть объектом.`);
    }
    if (![translator.firstName, translator.middleName, translator.lastName, translator.nickname].some(Boolean)) {
      throw new Error(`У переводчика ${index + 1} в formats.epub.translators укажите имя, фамилию, отчество или nickname.`);
    }
  }
}

function validateMiddleHtmlMetadata(config) {
  const settings = config.formats?.middleHtml ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('formats.middleHtml должен быть объектом.');
  }
  const language = settings.language ?? config.language;
  if (language != null && (typeof language !== 'string' || !language.trim())) {
    throw new Error('formats.middleHtml.language должен быть непустой строкой с кодом языка.');
  }
  if (settings.year != null && !['string', 'number'].includes(typeof settings.year)) {
    throw new Error('formats.middleHtml.year должен быть строкой или числом.');
  }
  if (settings.chapterPageBreak != null && typeof settings.chapterPageBreak !== 'boolean') {
    throw new Error('formats.middleHtml.chapterPageBreak должен быть true или false.');
  }

  const toc = settings.toc ?? {};
  if (!toc || typeof toc !== 'object' || Array.isArray(toc)) {
    throw new Error('formats.middleHtml.toc должен быть объектом.');
  }
  if (toc.title != null && (typeof toc.title !== 'string' || !toc.title.trim())) {
    throw new Error('formats.middleHtml.toc.title должен быть непустой строкой.');
  }
  if (toc.format != null && !['list', 'numbered', 'plain'].includes(toc.format)) {
    throw new Error('formats.middleHtml.toc.format должен быть list, numbered или plain.');
  }

  const page = settings.page ?? {};
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw new Error('formats.middleHtml.page должен быть объектом.');
  }
  const cssPageValue = /^[A-Za-z0-9.%\s-]+$/;
  for (const field of ['size', 'margin']) {
    if (page[field] != null && (typeof page[field] !== 'string' || !page[field].trim() || !cssPageValue.test(page[field]))) {
      throw new Error(`formats.middleHtml.page.${field} содержит недопустимое CSS-значение.`);
    }
  }
}

function validatePdfMetadata(config) {
  const settings = config.formats?.pdf ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('formats.pdf должен быть объектом.');
  }
  for (const field of ['widthCm', 'heightCm']) {
    if (settings[field] != null && (typeof settings[field] !== 'number' || !Number.isFinite(settings[field]) || settings[field] <= 0)) {
      throw new Error(`formats.pdf.${field} должен быть положительным числом.`);
    }
  }
  if (settings.marginCm != null && (typeof settings.marginCm !== 'number' || !Number.isFinite(settings.marginCm) || settings.marginCm < 0)) {
    throw new Error('formats.pdf.marginCm должен быть неотрицательным числом.');
  }
  for (const field of ['includeCover', 'pageNumbers']) {
    if (settings[field] != null && typeof settings[field] !== 'boolean') {
      throw new Error(`formats.pdf.${field} должен быть true или false.`);
    }
  }
  if (settings.cover != null && (typeof settings.cover !== 'string' || !settings.cover.trim())) {
    throw new Error('formats.pdf.cover должен быть непустым путём к изображению.');
  }
  if (settings.offset != null && (!Number.isInteger(settings.offset) || settings.offset < 0)) {
    throw new Error('formats.pdf.offset должен быть неотрицательным целым числом.');
  }
  if (settings.footerBottomCm != null && (typeof settings.footerBottomCm !== 'number' || !Number.isFinite(settings.footerBottomCm) || settings.footerBottomCm < 0)) {
    throw new Error('formats.pdf.footerBottomCm должен быть неотрицательным числом.');
  }
  if (settings.pageNumberAlignment != null && !['center', 'outer'].includes(settings.pageNumberAlignment)) {
    throw new Error('formats.pdf.pageNumberAlignment должен быть center или outer.');
  }
  for (const field of ['bodyFont', 'pageNumberFont', 'fontStylesheet']) {
    if (settings[field] != null && (typeof settings[field] !== 'string' || !settings[field].trim())) {
      throw new Error(`formats.pdf.${field} должен быть непустой строкой.`);
    }
  }
  if (settings.fonts != null && !Array.isArray(settings.fonts)) {
    throw new Error('formats.pdf.fonts должен быть массивом.');
  }
  for (const [index, font] of (settings.fonts ?? []).entries()) {
    if (!font || typeof font !== 'object' || Array.isArray(font)) {
      throw new Error(`Шрифт ${index + 1} в formats.pdf.fonts должен быть объектом.`);
    }
    if (typeof font.family !== 'string' || !font.family.trim()) {
      throw new Error(`У шрифта ${index + 1} в formats.pdf.fonts необходимо указать family.`);
    }
    for (const field of ['regular', 'italic', 'bold', 'boldItalic']) {
      if (font[field] != null && (typeof font[field] !== 'string' || !font[field].trim())) {
        throw new Error(`formats.pdf.fonts[${index}].${field} должен быть непустым путём.`);
      }
    }
  }
  const width = settings.widthCm ?? 12.7;
  const height = settings.heightCm ?? 20.32;
  const margin = settings.marginCm ?? 2;
  const footerBottom = settings.footerBottomCm ?? 0.5;
  if (margin * 2 >= Math.min(width, height)) {
    throw new Error('formats.pdf.marginCm должен оставлять положительную область страницы.');
  }
  if (footerBottom >= height) {
    throw new Error('formats.pdf.footerBottomCm должен быть меньше высоты страницы.');
  }
}

export async function loadBook(bookDir = getBookDir()) {
  const result = await validateBook(bookDir, { readText: true });
  const outputDir = join(bookDir, 'dist');
  await mkdir(outputDir, { recursive: true });
  return { ...result, outputDir };
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
