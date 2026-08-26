import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { authorName, escapeXml, loadBook } from './lib.mjs';

const args = process.argv.slice(2);
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'all';
const { bookDir, config, chapters, outputDir } = await loadBook();
const base = config.outputBaseName ?? config.id ?? 'book';

if (!['all', 'txt', 'fb2'].includes(format)) throw new Error(`Неизвестный формат: ${format}`);
if (format === 'all' || format === 'txt') await buildTxt();
if (format === 'all' || format === 'fb2') await buildFb2();

async function buildTxt() {
  const settings = config.formats?.txt ?? {};
  const separator = settings.separator ?? '='.repeat(72);
  const lineEnding = settings.lineEnding === 'lf' ? '\n' : '\r\n';
  const includeTitlePage = settings.includeTitlePage ?? true;

  const parts = [];
  if (includeTitlePage) parts.push(config.title, authorName(config.author), '', separator, '');

  chapters.forEach((chapter, i) => {
    parts.push(chapter.title, '', chapter.text);
    if (i < chapters.length - 1) parts.push('', separator, '');
  });

  const path = join(outputDir, `${base}.txt`);
  await writeFile(path, parts.join(lineEnding) + lineEnding, 'utf8');
  console.log(`TXT: ${path}`);
}

async function buildFb2() {
  const settings = config.formats?.fb2 ?? {};
  const document = settings.document ?? {};
  const publish = settings.publish ?? {};
  const sequence = settings.sequence ?? null;
  const bookId = document.id ?? createHash('sha256').update(`${config.title}\n${authorName(config.author)}`).digest('hex');
  const version = String(document.version ?? '1.0');
  const documentDate = document.date ?? new Date().toISOString().slice(0, 10);

  const sections = chapters.map((chapter, i) => `    <section id="chapter-${i + 1}">\n      <title><p>${escapeXml(chapter.title)}</p></title>\n${toFb2(chapter.text)}\n    </section>`).join('\n');
  const genres = (settings.genres ?? config.genres ?? ['prose']).map(g => `      <genre>${escapeXml(g)}</genre>`).join('\n');
  const annotation = config.annotation ? `\n      <annotation><p>${escapeXml(config.annotation)}</p></annotation>` : '';
  const keywords = settings.keywords?.length ? `\n      <keywords>${escapeXml(settings.keywords.join(', '))}</keywords>` : '';
  const sequenceXml = sequence?.name ? `\n      <sequence name="${escapeXml(sequence.name)}"${sequence.number != null ? ` number="${escapeXml(sequence.number)}"` : ''}/>` : '';
  const cover = await loadCover(settings.cover);
  const coverPage = cover ? `\n      <coverpage><image l:href="#${cover.id}"/></coverpage>` : '';
  const publishInfo = buildPublishInfo(publish, sequence);

  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n  <description>\n    <title-info>\n${genres}\n${fb2Author(config.author)}\n      <book-title>${escapeXml(config.title)}</book-title>${annotation}${keywords}\n      <lang>${escapeXml(config.language ?? 'ru')}</lang>${coverPage}${sequenceXml}\n    </title-info>\n    <document-info>\n      <author><nickname>${escapeXml(document.author ?? 'Book Framework')}</nickname></author>\n      <program-used>@nedobylskiy/book-framework</program-used>\n      <date value="${escapeXml(documentDate)}">${escapeXml(documentDate)}</date>\n      <id>${escapeXml(bookId)}</id>\n      <version>${escapeXml(version)}</version>\n    </document-info>${publishInfo}\n  </description>\n  <body>\n${sections}\n  </body>${cover ? `\n  <binary id="${cover.id}" content-type="${cover.mime}">${cover.data}</binary>` : ''}\n</FictionBook>\n`;

  const path = join(outputDir, `${base}.fb2`);
  await writeFile(path, xml, 'utf8');
  console.log(`FB2: ${path}`);
}

function fb2Author(author = {}) {
  const fields = [];
  if (author.firstName) fields.push(`        <first-name>${escapeXml(author.firstName)}</first-name>`);
  if (author.middleName) fields.push(`        <middle-name>${escapeXml(author.middleName)}</middle-name>`);
  if (author.lastName) fields.push(`        <last-name>${escapeXml(author.lastName)}</last-name>`);
  if (author.nickname) fields.push(`        <nickname>${escapeXml(author.nickname)}</nickname>`);
  if (author.email) fields.push(`        <email>${escapeXml(author.email)}</email>`);
  if (author.homePage) fields.push(`        <home-page>${escapeXml(author.homePage)}</home-page>`);
  return `      <author>\n${fields.join('\n')}\n      </author>`;
}

function buildPublishInfo(publish, sequence) {
  const rows = [];
  if (publish.bookName) rows.push(`      <book-name>${escapeXml(publish.bookName)}</book-name>`);
  if (publish.publisher) rows.push(`      <publisher>${escapeXml(publish.publisher)}</publisher>`);
  if (publish.city) rows.push(`      <city>${escapeXml(publish.city)}</city>`);
  if (publish.year != null) rows.push(`      <year>${escapeXml(publish.year)}</year>`);
  if (publish.isbn) rows.push(`      <isbn>${escapeXml(publish.isbn)}</isbn>`);
  if (sequence?.name) rows.push(`      <sequence name="${escapeXml(sequence.name)}"${sequence.number != null ? ` number="${escapeXml(sequence.number)}"` : ''}/>`);
  return rows.length ? `\n    <publish-info>\n${rows.join('\n')}\n    </publish-info>` : '';
}

async function loadCover(relativePath) {
  if (!relativePath) return null;
  const path = resolve(bookDir, relativePath);
  const extension = extname(path).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : null;
  if (!mime) throw new Error('FB2 cover поддерживает PNG, JPG или JPEG.');
  const data = (await readFile(path)).toString('base64');
  return { id: `cover${extension === '.jpeg' ? '.jpg' : extension}`, mime, data };
}

function toFb2(text) {
  return text
    .split(/\n{2,}/)
    .flatMap(block => block.split('\n').map(x => x.trim()).filter(Boolean))
    .map(line => `      <p>${escapeXml(line)}</p>`)
    .join('\n');
}
