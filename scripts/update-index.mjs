import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { booksDir, root } from './lib.mjs';

const start = '<!-- BOOKS:START -->';
const end = '<!-- BOOKS:END -->';
const entries = await readdir(booksDir, { withFileTypes: true }).catch(() => []);
const books = [];
for (const entry of entries.filter(e => e.isDirectory())) {
  try {
    const config = JSON.parse(await readFile(join(booksDir, entry.name, 'book.config.json'),'utf8'));
    books.push({ slug: entry.name, ...config });
  } catch {}
}
books.sort((a,b) => a.title.localeCompare(b.title,'ru'));
const body = books.length ? books.map(b => `### [${b.title}](books/${b.slug}/)\n\n**Статус:** ${b.status ?? 'не указан'}\n\n${b.annotation ?? ''}`).join('\n\n') : 'Пока проектов нет.';
const path = join(root,'README.md');
const readme = await readFile(path,'utf8');
const a = readme.indexOf(start), b = readme.indexOf(end);
if (a < 0 || b < 0 || b < a) throw new Error('В README отсутствуют маркеры каталога книг.');
const next = readme.slice(0,a + start.length) + '\n' + body + '\n' + readme.slice(b);
await writeFile(path,next,'utf8');
console.log(`Каталог обновлён: ${books.length} книг.`);
