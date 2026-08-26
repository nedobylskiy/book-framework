import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

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

export async function validateBook(bookDir = getBookDir(), { readText = true } = {}) {
  const config = await loadConfig(bookDir);

  if (!config.title || !authorName(config.author)) {
    throw new Error('В book.config.json необходимо указать title и author.');
  }
  if (!Array.isArray(config.chapters) || !config.chapters.length) {
    throw new Error('В book.config.json не указан список chapters.');
  }

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

  return { bookDir, config, chapters, sourceDir };
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
