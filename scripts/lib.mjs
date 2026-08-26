import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const root = resolve(scriptsDir, '..');

export function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

export function authorName(author = {}) {
  return [author.firstName, author.middleName, author.lastName].filter(Boolean).join(' ');
}

export async function loadBook() {
  const bookDir = root;
  const config = JSON.parse(await readFile(join(bookDir, 'book.config.json'), 'utf8'));

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

    chapters.push({ ...chapter, number, text: normalizeText(await readFile(filePath, 'utf8')) });
  }

  const outputDir = join(bookDir, 'dist');
  await mkdir(outputDir, { recursive: true });
  return { bookDir, config, chapters, outputDir };
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
