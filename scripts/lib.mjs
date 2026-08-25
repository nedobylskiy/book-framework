import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const root = resolve(scriptsDir, '..');
export const booksDir = join(root, 'books');

export function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

export function authorName(author = {}) {
  return [author.firstName, author.middleName, author.lastName].filter(Boolean).join(' ');
}

export async function loadBook(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-_]*$/i.test(slug)) throw new Error('Укажите slug книги.');
  const bookDir = resolve(booksDir, slug);
  const config = JSON.parse(await readFile(join(bookDir, 'book.config.json'), 'utf8'));
  if (!config.title || !authorName(config.author)) throw new Error('В конфиге нужны title и author.');
  if (!Array.isArray(config.chapters) || !config.chapters.length) throw new Error('В конфиге нет глав.');
  const sourceKind = config.buildSource ?? 'edited';
  const sourceDir = join(bookDir, 'manuscript', sourceKind === 'original' ? 'chapters' : 'edited');
  const chapters = [];
  for (const chapter of config.chapters) {
    if (!chapter.title || !chapter.file) throw new Error('У главы нужны title и file.');
    const path = resolve(sourceDir, chapter.file);
    if (!path.startsWith(sourceDir + '/') && path !== sourceDir) throw new Error(`Недопустимый путь: ${chapter.file}`);
    chapters.push({ ...chapter, text: normalizeText(await readFile(path, 'utf8')) });
  }
  const outputDir = join(bookDir, 'dist');
  await mkdir(outputDir, { recursive: true });
  return { slug, bookDir, config, chapters, outputDir };
}

export function escapeXml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
}
