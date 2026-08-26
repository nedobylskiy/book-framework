import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authorName, escapeXml, loadBook } from './lib.mjs';

const args = process.argv.slice(2);
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'all';
const { config, chapters, outputDir } = await loadBook();
const base = config.outputBaseName ?? config.id ?? 'book';

if (!['all', 'txt', 'fb2'].includes(format)) throw new Error(`Неизвестный формат: ${format}`);
if (format === 'all' || format === 'txt') await buildTxt();
if (format === 'all' || format === 'fb2') await buildFb2();

async function buildTxt() {
  const divider = '='.repeat(72);
  const parts = [config.title, authorName(config.author), '', divider, ''];
  chapters.forEach((chapter, i) => {
    parts.push(chapter.title, '', chapter.text);
    if (i < chapters.length - 1) parts.push('', divider, '');
  });
  const path = join(outputDir, `${base}.txt`);
  await writeFile(path, parts.join('\r\n') + '\r\n', 'utf8');
  console.log(`TXT: ${path}`);
}

async function buildFb2() {
  const id = createHash('sha256').update(`${config.title}\n${authorName(config.author)}`).digest('hex');
  const sections = chapters.map((chapter, i) => `    <section id="chapter-${i + 1}">\n      <title><p>${escapeXml(chapter.title)}</p></title>\n${toFb2(chapter.text)}\n    </section>`).join('\n');
  const genres = (config.genres?.length ? config.genres : ['prose']).map(g => `      <genre>${escapeXml(g)}</genre>`).join('\n');
  const annotation = config.annotation ? `\n      <annotation><p>${escapeXml(config.annotation)}</p></annotation>` : '';
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">\n  <description>\n    <title-info>\n${genres}\n      <author><first-name>${escapeXml(config.author.firstName ?? '')}</first-name><last-name>${escapeXml(config.author.lastName ?? '')}</last-name></author>\n      <book-title>${escapeXml(config.title)}</book-title>${annotation}\n      <lang>${escapeXml(config.language ?? 'ru')}</lang>\n    </title-info>\n    <document-info><author><nickname>Book Framework</nickname></author><id>${id}</id><version>1.0</version></document-info>\n  </description>\n  <body>\n${sections}\n  </body>\n</FictionBook>\n`;
  const path = join(outputDir, `${base}.fb2`);
  await writeFile(path, xml, 'utf8');
  console.log(`FB2: ${path}`);
}

function toFb2(text) {
  return text
    .split(/\n{2,}/)
    .flatMap(block => block.split('\n').map(x => x.trim()).filter(Boolean))
    .map(line => `      <p>${escapeXml(line)}</p>`)
    .join('\n');
}
