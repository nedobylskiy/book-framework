import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getBookDir, loadConfig } from './lib.mjs';

const args = process.argv.slice(2);
const slug = args[0];
const titleIndex = args.indexOf('--title');
const title = titleIndex >= 0 ? args[titleIndex + 1] : null;

if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
  throw new Error('Использование: book new-chapter chapter-slug [--title "Название главы"]');
}

const bookDir = getBookDir();
const configPath = join(bookDir, 'book.config.json');
const config = await loadConfig(bookDir);
if (!Array.isArray(config.chapters)) config.chapters = [];

const number = config.chapters.length + 1;
const prefix = String(number).padStart(2, '0');
const file = `${prefix}-${slug}.txt`;
const chapterTitle = title ?? `Глава ${number}`;

for (const dir of ['manuscript/chapters', 'manuscript/edited']) {
  await mkdir(join(bookDir, dir), { recursive: true });
}

const originalPath = join(bookDir, 'manuscript/chapters', file);
const editedPath = join(bookDir, 'manuscript/edited', file);

await writeFile(originalPath, '', { encoding: 'utf8', flag: 'wx' });
await writeFile(editedPath, '', { encoding: 'utf8', flag: 'wx' });

config.chapters.push({ title: chapterTitle, file });
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`Создана глава ${prefix}: ${chapterTitle}`);
console.log(`Авторский текст: manuscript/chapters/${file}`);
console.log(`Редактура: manuscript/edited/${file}`);
