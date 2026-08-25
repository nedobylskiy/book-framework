import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { booksDir } from './lib.mjs';

const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-_]*$/i.test(slug)) throw new Error('Использование: npm run new -- book-slug');
const dir = join(booksDir, slug);
const dirs = ['manuscript/chapters','manuscript/edited','docs','dist'];
for (const sub of dirs) await mkdir(join(dir, sub), { recursive: true });

const config = {
  id: slug,
  title: 'Название книги',
  annotation: 'Аннотация книги.',
  status: 'idea',
  author: { firstName: 'Имя', lastName: 'Фамилия' },
  language: 'ru',
  buildSource: 'edited',
  outputBaseName: slug,
  genres: ['prose'],
  chapters: [{ title: 'Глава 1', file: '01-chapter.txt' }]
};
await writeFile(join(dir,'book.config.json'), JSON.stringify(config,null,2)+'\n');
await writeFile(join(dir,'README.md'), `# ${config.title}\n\n${config.annotation}\n\n## Состояние\n\n${config.status}\n`);
await writeFile(join(dir,'manuscript/chapters/01-chapter.txt'), 'Текст первой главы.\n');
await writeFile(join(dir,'manuscript/edited/01-chapter.txt'), 'Текст первой главы.\n');
await writeFile(join(dir,'manuscript/edited/EDITING_RULES.md'), '# Правила редактуры\n\nЗапишите здесь правила, обязательные для редактуры именно этой книги.\n\n## Авторский голос\n\n- TODO\n\n## Что можно менять\n\n- Орфографию и пунктуацию.\n\n## Что нельзя менять без решения автора\n\n- События, канон и мотивацию персонажей.\n');
const docs = {
  'characters.md':'# Персонажи\n', 'world.md':'# Мир\n', 'organizations.md':'# Организации и группировки\n',
  'locations.md':'# Локации\n', 'technology.md':'# Технологии и системы мира\n', 'plot.md':'# Сюжет\n',
  'timeline.md':'# Хронология\n', 'continuity.md':'# Continuity и канон\n\nФакты, которые нельзя случайно нарушить в следующих главах.\n'
};
for (const [name, text] of Object.entries(docs)) await writeFile(join(dir,'docs',name), text);
console.log(`Создан проект books/${slug}`);
