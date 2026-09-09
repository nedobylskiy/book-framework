import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { authorName, escapeXml, loadBook } from './lib.mjs';

const args = process.argv.slice(2);
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'all';
const chaptersMode = args.includes('--chapters');
const { bookDir, config, chapters, outputDir } = await loadBook();
const base = config.outputBaseName ?? config.id ?? 'book';
const manuscript = prepareManuscript(chapters);

if (!['all', 'txt', 'fb2'].includes(format)) throw new Error(`Неизвестный формат: ${format}`);
if (chaptersMode && format === 'txt') throw new Error('--chapters поддерживается только для FB2.');

if (!chaptersMode && (format === 'all' || format === 'txt')) await buildTxt();
if (format === 'all' || format === 'fb2') {
  if (chaptersMode) await buildFb2Chapters();
  else await buildFb2();
}

async function buildTxt() {
  const settings = config.formats?.txt ?? {};
  const separator = settings.separator ?? '='.repeat(72);
  const lineEnding = settings.lineEnding === 'lf' ? '\n' : '\r\n';
  const includeTitlePage = settings.includeTitlePage ?? true;

  const parts = [];
  if (includeTitlePage) parts.push(config.title, authorName(config.author), '', separator, '');

  manuscript.chapters.forEach((chapter, i) => {
    parts.push(chapter.title, '', renderTxtBody(chapter.text, manuscript.footnoteNumbers));
    if (i < manuscript.chapters.length - 1) parts.push('', separator, '');
  });

  if (manuscript.footnotes.length) {
    parts.push('', '______', '');
    for (const note of manuscript.footnotes) {
      parts.push(`${toSuperscript(note.number)} ${renderTxtInline(note.text, manuscript.footnoteNumbers)}`);
    }
  }

  const path = join(outputDir, `${base}.txt`);
  await writeFile(path, parts.join(lineEnding) + lineEnding, 'utf8');
  console.log(`TXT: ${path}`);
}

async function buildFb2() {
  const xml = await createFb2({ chapters: manuscript.chapters, footnotes: manuscript.footnotes });
  const path = join(outputDir, `${base}.fb2`);
  await writeFile(path, xml, 'utf8');
  console.log(`FB2: ${path}`);
}

async function buildFb2Chapters() {
  const chaptersDir = join(outputDir, 'chapters');
  await mkdir(chaptersDir, { recursive: true });

  for (const chapter of manuscript.chapters) {
    const referencedIds = collectFootnoteRefs(chapter.text);
    const chapterFootnotes = manuscript.footnotes.filter(note => referencedIds.has(note.id));
    const xml = await createFb2({ chapters: [chapter], footnotes: chapterFootnotes, idSuffix: chapter.file });
    const fileName = `${basename(chapter.file, extname(chapter.file))}.fb2`;
    const path = join(chaptersDir, fileName);
    await writeFile(path, xml, 'utf8');
    console.log(`FB2 chapter: ${path}`);
  }
}

async function createFb2({ chapters: selectedChapters, footnotes = [], idSuffix = '' }) {
  const settings = config.formats?.fb2 ?? {};
  const document = settings.document ?? {};
  const publish = settings.publish ?? {};
  const sequence = settings.sequence ?? null;
  const baseId = document.id ?? `${config.title}\n${authorName(config.author)}`;
  const bookId = createHash('sha256').update(idSuffix ? `${baseId}\n${idSuffix}` : baseId).digest('hex');
  const version = String(document.version ?? '1.0');
  const documentDate = document.date ?? new Date().toISOString().slice(0, 10);

  const sections = selectedChapters.map((chapter, i) => `    <section id="chapter-${i + 1}">\n      <title><p>${escapeXml(chapter.title)}</p></title>\n${toFb2(chapter.text, manuscript.footnoteNumbers)}\n    </section>`).join('\n');
  const notesBody = buildFb2Notes(footnotes, manuscript.footnoteNumbers);
  const genres = (settings.genres ?? config.genres ?? ['prose']).map(g => `      <genre>${escapeXml(g)}</genre>`).join('\n');
  const annotation = config.annotation ? `\n      <annotation><p>${escapeXml(config.annotation)}</p></annotation>` : '';
  const keywords = settings.keywords?.length ? `\n      <keywords>${escapeXml(settings.keywords.join(', '))}</keywords>` : '';
  const sequenceXml = sequence?.name ? `\n      <sequence name="${escapeXml(sequence.name)}"${sequence.number != null ? ` number="${escapeXml(sequence.number)}"` : ''}/>` : '';
  const cover = await loadCover(settings.cover);
  const coverPage = cover ? `\n      <coverpage><image l:href="#${cover.id}"/></coverpage>` : '';
  const publishInfo = buildPublishInfo(publish, sequence);

  return `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n  <description>\n    <title-info>\n${genres}\n${fb2Author(config.author)}\n      <book-title>${escapeXml(config.title)}</book-title>${annotation}${keywords}\n      <lang>${escapeXml(config.language ?? 'ru')}</lang>${coverPage}${sequenceXml}\n    </title-info>\n    <document-info>\n      <author><nickname>${escapeXml(document.author ?? 'Book Framework')}</nickname></author>\n      <program-used>@nedobylskiy/book-framework</program-used>\n      <date value="${escapeXml(documentDate)}">${escapeXml(documentDate)}</date>\n      <id>${escapeXml(bookId)}</id>\n      <version>${escapeXml(version)}</version>\n    </document-info>${publishInfo}\n  </description>\n  <body>\n${sections}\n  </body>${notesBody}${cover ? `\n  <binary id="${cover.id}" content-type="${cover.mime}">${cover.data}</binary>` : ''}\n</FictionBook>\n`;
}

function prepareManuscript(sourceChapters) {
  const definitions = new Map();
  const cleanedChapters = sourceChapters.map(chapter => {
    const lines = chapter.text.split('\n');
    const bodyLines = [];

    for (const line of lines) {
      const match = /^\s*\[\^([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
      if (!match) {
        bodyLines.push(line);
        continue;
      }

      const [, id, text] = match;
      if (definitions.has(id)) throw new Error(`Сноска [^${id}] определена больше одного раза.`);
      definitions.set(id, text);
    }

    return { ...chapter, text: bodyLines.join('\n').trim() };
  });

  const footnoteNumbers = new Map();
  const orderedIds = [];
  for (const chapter of cleanedChapters) {
    for (const id of collectFootnoteRefsInOrder(chapter.text)) {
      if (!footnoteNumbers.has(id)) {
        footnoteNumbers.set(id, footnoteNumbers.size + 1);
        orderedIds.push(id);
      }
    }
  }

  for (const id of orderedIds) {
    if (!definitions.has(id)) throw new Error(`Для сноски [^${id}] отсутствует определение [^${id}]: ...`);
  }

  for (const id of definitions.keys()) {
    if (!footnoteNumbers.has(id)) throw new Error(`Сноска [^${id}] определена, но нигде не используется.`);
  }

  const footnotes = orderedIds.map(id => ({ id, number: footnoteNumbers.get(id), text: definitions.get(id) }));
  return { chapters: cleanedChapters, footnotes, footnoteNumbers };
}

function collectFootnoteRefsInOrder(text) {
  return [...text.matchAll(/\[\^([^\]]+)\]/g)].map(match => match[1]);
}

function collectFootnoteRefs(text) {
  return new Set(collectFootnoteRefsInOrder(text));
}

function renderTxtBody(text, footnoteNumbers) {
  return text
    .replace(/\n\s*---\s*\n/g, '\n\n\n')
    .split('\n')
    .map(line => renderTxtInline(line, footnoteNumbers))
    .join('\n');
}

function renderTxtInline(text, footnoteNumbers) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => label === url ? url : `${label} (${url})`)
    .replace(/\[\^([^\]]+)\]/g, (_, id) => toSuperscript(footnoteNumbers.get(id)));
}

function toSuperscript(number) {
  const digits = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(number).split('').map(digit => digits[digit]).join('');
}

function toFb2(text, footnoteNumbers) {
  const lines = text.split('\n');
  const output = [];

  for (const line of lines) {
    if (line.trim() === '---') {
      output.push('      <empty-line/>', '      <empty-line/>');
      continue;
    }
    if (!line.trim()) continue;
    output.push(`      <p>${renderFb2Inline(line.trim(), footnoteNumbers)}</p>`);
  }

  return output.join('\n');
}

function renderFb2Inline(text, footnoteNumbers) {
  const tokenPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([^\]]+)\]/g;
  let output = '';
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    output += escapeXml(text.slice(cursor, match.index));
    if (match[1] != null) {
      output += `<a l:href="${escapeXml(match[2])}">${escapeXml(match[1])}</a>`;
    } else {
      const id = match[3];
      const number = footnoteNumbers.get(id);
      output += `<a l:href="#note-${number}" type="note">${number}</a>`;
    }
    cursor = match.index + match[0].length;
  }

  output += escapeXml(text.slice(cursor));
  return output;
}

function buildFb2Notes(footnotes, footnoteNumbers) {
  if (!footnotes.length) return '';
  const sections = footnotes.map(note => `    <section id="note-${note.number}">\n      <title><p>${note.number}</p></title>\n      <p>${renderFb2Inline(note.text, footnoteNumbers)}</p>\n    </section>`).join('\n');
  return `\n  <body name="notes">\n${sections}\n  </body>`;
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
