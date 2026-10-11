import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import yazl from 'yazl';
import { authorName, escapeXml, loadBook } from './lib.mjs';

const args = process.argv.slice(2);
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'all';
const chaptersMode = args.includes('--chapters');
const { bookDir, config, chapters, outputDir } = await loadBook();
const base = config.outputBaseName ?? config.id ?? 'book';
const manuscript = prepareManuscript(chapters);

if (!['all', 'txt', 'fb2', 'epub', 'middle-html', 'pdf'].includes(format)) throw new Error(`Неизвестный формат: ${format}`);
if (chaptersMode && !['all', 'fb2'].includes(format)) throw new Error('--chapters поддерживается только для FB2.');

if (!chaptersMode && (format === 'all' || format === 'txt')) await buildTxt();
if (format === 'all' || format === 'fb2') {
  if (chaptersMode) await buildFb2Chapters();
  else await buildFb2();
}
if (!chaptersMode && (format === 'all' || format === 'epub')) await buildEpub();
if (!chaptersMode && format === 'middle-html') await buildMiddleHtml();
if (!chaptersMode && (format === 'all' || format === 'pdf')) await buildPdf();

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

async function buildMiddleHtml({ settings = config.formats?.middleHtml ?? {}, cover = null, pdfMode = false, tocPageNumbers = null, logOutput = true, additionalStyles = '', showContents = true, contentsPosition = 'end' } = {}) {
  const language = settings.language ?? config.language ?? 'ru';
  const toc = settings.toc ?? {};
  const tocTitle = toc.title ?? 'Оглавление';
  const tocFormat = toc.format ?? 'list';
  const year = settings.year ?? config.formats?.fb2?.publish?.year ?? new Date().getFullYear();
  const images = await loadBodyImages(manuscript.chapters);
  const stylesheet = `${await middleHtmlStyles(settings, { pdfMode })}${additionalStyles ? `\n${additionalStyles}` : ''}`;
  const chapters = manuscript.chapters.map((chapter, index) => ({ ...chapter, id: `chapter-${index + 1}` }));

  const coverPage = cover ? `  <section class="pdf-cover" aria-label="Обложка">\n    <img src="data:${cover.mime};base64,${cover.data}" alt="Обложка: ${escapeXml(config.title)}">\n  </section>\n` : '';
  const titlePage = `  <section class="title-page" aria-labelledby="book-title">\n    <div class="title-page__main">\n      <h1 id="book-title">${escapeXml(config.title)}</h1>\n      <p class="title-page__author">${escapeXml(authorName(config.author))}</p>\n    </div>\n    <p class="title-page__year">${escapeXml(year)}</p>\n  </section>`;
  const tocAtEnd = pdfMode && contentsPosition === 'end';
  const tocPage = showContents ? middleHtmlToc(chapters, tocTitle, tocFormat, { atEnd: tocAtEnd, pageNumbers: tocPageNumbers, pdfMarker: pdfMode }) : '';
  const chapterClass = settings.chapterPageBreak === false ? 'book-content' : 'book-content book-content--chapter-breaks';
  const chapterHtml = chapters.map((chapter, index) => `    <section class="chapter" id="${chapter.id}">\n      <h1>${pdfMode ? `<span class="pdf-chapter-marker">BOOK_FRAMEWORK_CHAPTER_${index + 1}</span>` : ''}${escapeXml(chapter.title)}</h1>\n${toMiddleHtml(chapter.text, manuscript.footnoteNumbers, images)}\n    </section>`).join('\n');
  const notes = middleHtmlNotes();
  const tocBeforeContent = !pdfMode || contentsPosition === 'start' ? (tocPage ? `${tocPage}\n` : '') : '';
  const tocAfterContent = tocAtEnd && tocPage ? `\n${tocPage}` : '';

  const baseElement = pdfMode ? `\n  <base href="${escapeXml(pathToFileURL(bookDir + sep).href)}">` : '';
  const html = `<!doctype html>\n<html lang="${escapeXml(language)}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">${baseElement}\n  <title>${escapeXml(config.title)}</title>\n  <style>\n${stylesheet}\n  </style>\n</head>\n<body>\n${coverPage}${titlePage}\n${tocBeforeContent}  <main class="${chapterClass}">\n${chapterHtml}\n  </main>${notes}${tocAfterContent}\n</body>\n</html>\n`;

  const path = join(outputDir, `${base}.middle.html`);
  await writeFile(path, html, 'utf8');
  if (logOutput) console.log(`Middle HTML: ${path}`);
  return path;
}

async function buildPdf() {
  const settings = config.formats?.pdf ?? {};
  const widthCm = settings.widthCm ?? 12.7;
  const heightCm = settings.heightCm ?? 20.32;
  const marginCm = settings.marginCm ?? 2;
  const includeCover = settings.includeCover ?? false;
  const pageNumbers = settings.pageNumbers ?? false;
  const pageNumberOffset = settings.offset ?? 1;
  const footerBottomCm = settings.footerBottomCm ?? 0.5;
  const pageNumberAlignment = settings.pageNumberAlignment ?? 'center';
  const showContents = settings.contents ?? true;
  const contentsPosition = settings.contentsPosition ?? 'end';
  const emptyPages = [...(settings.emptyPages ?? [])].sort((a, b) => a - b);
  const pdfFonts = await loadPdfFonts(settings);
  const coverPath = settings.cover ?? config.formats?.epub?.cover ?? config.formats?.fb2?.cover;
  if (includeCover && !coverPath) {
    throw new Error('Для formats.pdf.includeCover=true укажите formats.pdf.cover, formats.epub.cover или formats.fb2.cover.');
  }
  const cover = includeCover ? await loadImage(coverPath, 'cover') : null;
  const middleSettings = config.formats?.middleHtml ?? {};
  const htmlPath = await buildMiddleHtml({
    settings: {
      ...middleSettings,
      page: {
        ...(middleSettings.page ?? {}),
        size: `${widthCm}cm ${heightCm}cm`,
        margin: `${marginCm}cm`
      }
    },
    cover,
    pdfMode: true,
    logOutput: false,
    additionalStyles: pdfFonts.styles,
    showContents,
    contentsPosition
  });
  const pdfPath = join(outputDir, `${base}.pdf`);
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('requestfailed', request => {
      if (request.resourceType() === 'font') {
        console.warn(`Предупреждение: браузер не смог загрузить шрифт ${request.url()}. Используется резервный шрифт.`);
      }
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await waitForPdfFonts(page);
    const pdfOptions = {
      width: `${widthCm}cm`,
      height: `${heightCm}cm`,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false
    };
    const draftPdf = await page.pdf(pdfOptions);
    const layout = await findPdfLayout(draftPdf, manuscript.chapters.length, { expectContents: showContents });
    const pagePlan = createPdfPagePlan(layout.totalPages, emptyPages);
    const firstContentPage = layout.chapterPages[0];
    const chapterPageNumbers = layout.chapterPages.map(pageNumber => pageNumberOffset + pagePlan.baseToFinal[pageNumber] - 1);
    await buildMiddleHtml({
      settings: {
        ...middleSettings,
        page: {
          ...(middleSettings.page ?? {}),
          size: `${widthCm}cm ${heightCm}cm`,
          margin: `${marginCm}cm`
        }
      },
      cover,
      pdfMode: true,
      tocPageNumbers: chapterPageNumbers,
      additionalStyles: pdfFonts.styles,
      showContents,
      contentsPosition
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await waitForPdfFonts(page);
    const finalPdf = await page.pdf(pdfOptions);
    const lastContentPage = showContents && contentsPosition === 'end' ? layout.tocPage - 1 : layout.totalPages;
    const numberedBasePages = [];
    for (let pageNumber = firstContentPage; pageNumber <= lastContentPage; pageNumber += 1) numberedBasePages.push(pageNumber);
    const output = pageNumbers || emptyPages.length
      ? await finalizePdf(finalPdf, {
        emptyPages,
        numberedBasePages: pageNumbers ? numberedBasePages : [],
        baseToFinal: pagePlan.baseToFinal,
        offset: pageNumberOffset,
        footerBottomCm,
        horizontalMarginCm: marginCm,
        alignment: pageNumberAlignment,
        fontData: pdfFonts.pageNumberFontData
      })
      : finalPdf;
    await writeFile(pdfPath, output);
  } finally {
    await browser.close();
  }
  console.log(`PDF: ${pdfPath}`);
}

async function waitForPdfFonts(page) {
  const failedFamilies = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(font => font.status === 'error').map(font => font.family);
  });
  for (const family of new Set(failedFamilies)) {
    console.warn(`Предупреждение: шрифт ${family} не загрузился в HTML. Используется резервный шрифт.`);
  }
}

async function middleHtmlStyles(settings, { pdfMode = false } = {}) {
  const page = settings.page ?? {};
  const pageRules = [page.size ? `size: ${page.size};` : '', `margin: ${page.margin ?? '20mm'};`].filter(Boolean).join(' ');
  const defaults = `    @page { ${pageRules} }\n    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; line-height: 1.5; }\n    * { box-sizing: border-box; }\n    body { margin: 0; color: #111; background: #fff; }\n    .title-page { min-height: 100vh; display: flex; flex-direction: column; text-align: center; break-after: page; page-break-after: always; }\n    .title-page__main { margin: auto 0; }\n    .title-page h1 { margin: 0 0 1.25rem; font-size: 2.2rem; }\n    .title-page__author { margin: 0; font-size: 1.2rem; text-indent: 0; }\n    .title-page__year { margin: auto 0 0; text-indent: 0; }\n    .table-of-contents { break-after: page; page-break-after: always; }\n    .table-of-contents h1, .chapter > h1, .notes > h1 { text-align: center; }\n    .toc-list { padding: 0; list-style-position: inside; }\n    .toc-list--plain { list-style: none; }\n    .toc-list li, .toc-plain-entry { margin: 0.6em 0; }\n    .toc-list a, .toc-plain-entry a { color: inherit; text-decoration: none; }\n    .chapter + .chapter { margin-top: 3rem; }\n    .book-content--chapter-breaks .chapter + .chapter { break-before: page; page-break-before: always; margin-top: 0; }\n    p { margin: 0 0 0.7em; text-indent: 1.5em; }\n    pre { font-family: ui-monospace, "Cascadia Mono", monospace; white-space: pre-wrap; }\n    figure { margin: 1.5em auto; text-align: center; }\n    img { max-width: 100%; height: auto; }\n    hr.scene-break { width: 20%; margin: 1.75em auto; border: 0; border-top: 1px solid currentColor; }\n    .notes { break-before: page; page-break-before: always; }\n    .notes p { text-indent: 0; }\n    @media screen { body { max-width: 760px; margin: 0 auto; padding: 3rem; } }`;

  const coverStyles = `    @page cover { ${page.size ? `size: ${page.size};` : ''} margin: 0; }\n    @page content { ${pageRules} }\n    .pdf-cover { page: cover; width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; }\n    .pdf-cover img { width: 100%; height: 100%; object-fit: contain; }\n    .title-page, .table-of-contents, .book-content, .notes { page: content; }`;
  const pdfStyles = pdfMode ? `\n    .title-page { min-height: calc(100vh - 2 * ${page.margin}); }\n    .table-of-contents--at-end { break-before: page; page-break-before: always; break-after: auto; page-break-after: auto; }\n    .pdf-chapter-marker { color: transparent; font-size: 0.1px; line-height: 0; }\n    .toc-row { display: flex; align-items: baseline; gap: 0.4em; }\n    .toc-row a { flex: 0 1 auto; }\n    .toc-leader { flex: 1 1 auto; border-bottom: 1px dotted currentColor; transform: translateY(-0.25em); }\n    .toc-page-number { flex: 0 0 auto; font-variant-numeric: tabular-nums; }` : '';
  if (!settings.stylesheet) return `${defaults}\n${coverStyles}${pdfStyles}`;
  const path = resolve(bookDir, normalizeAssetPath(settings.stylesheet));
  if (!path.startsWith(bookDir + sep) && path !== bookDir) throw new Error(`Путь Middle HTML stylesheet выходит за пределы репозитория: ${settings.stylesheet}`);
  return `${defaults}\n${coverStyles}${pdfStyles}\n\n    /* Custom stylesheet */\n${await readFile(path, 'utf8')}`;
}

function middleHtmlToc(chapters, title, format, { atEnd = false, pageNumbers = null, pdfMarker = false } = {}) {
  const links = chapters.map((chapter, index) => {
    const link = `<a href="#${chapter.id}">${escapeXml(chapter.title)}</a>`;
    if (!pageNumbers) return link;
    return `<span class="toc-row">${link}<span class="toc-leader" aria-hidden="true"></span><span class="toc-page-number">${pageNumbers[index]}</span></span>`;
  });
  let contents;
  if (format === 'plain') contents = links.map(link => `    <p class="toc-plain-entry">${link}</p>`).join('\n');
  else {
    const tag = format === 'numbered' ? 'ol' : 'ul';
    const modifier = format === 'numbered' ? 'toc-list--numbered' : 'toc-list--plain';
    contents = `    <${tag} class="toc-list ${modifier}">\n${links.map(link => `      <li>${link}</li>`).join('\n')}\n    </${tag}>`;
  }
  const classes = atEnd ? 'table-of-contents table-of-contents--at-end' : 'table-of-contents';
  const marker = pdfMarker ? '<span class="pdf-chapter-marker">BOOK_FRAMEWORK_TOC</span>' : '';
  return `  <nav class="${classes}" aria-labelledby="toc-title">\n    <h1 id="toc-title">${marker}${escapeXml(title)}</h1>\n${contents}\n  </nav>`;
}

async function findPdfLayout(pdfData, chapterCount, { expectContents }) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(pdfData), disableWorker: true });
  const document = await loadingTask.promise;
  const totalPages = document.numPages;
  const pages = Array(chapterCount).fill(null);
  let tocPage = null;
  try {
    for (let pageNumber = 1; pageNumber <= totalPages && (pages.some(value => value == null) || (expectContents && tocPage == null)); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const contents = text.items.map(item => item.str).join(' ');
      for (let index = 0; index < chapterCount; index += 1) {
        if (pages[index] == null && contents.includes(`BOOK_FRAMEWORK_CHAPTER_${index + 1}`)) pages[index] = pageNumber;
      }
      if (tocPage == null && contents.includes('BOOK_FRAMEWORK_TOC')) tocPage = pageNumber;
    }
  } finally {
    await loadingTask.destroy();
  }
  const missing = pages.findIndex(value => value == null);
  if (missing >= 0) throw new Error(`Не удалось определить страницу главы ${missing + 1} для PDF-оглавления.`);
  if (expectContents && tocPage == null) throw new Error('Не удалось определить страницу PDF-оглавления.');
  return { chapterPages: pages, tocPage, totalPages };
}

function createPdfPagePlan(basePageCount, emptyPages) {
  const remaining = new Set(emptyPages);
  const baseToFinal = Array(basePageCount + 1).fill(null);
  let basePage = 1;
  let finalPage = 1;
  while (basePage <= basePageCount) {
    if (remaining.delete(finalPage)) {
      finalPage += 1;
      continue;
    }
    baseToFinal[basePage] = finalPage;
    basePage += 1;
    finalPage += 1;
  }
  while (remaining.delete(finalPage)) finalPage += 1;
  if (remaining.size) {
    throw new Error(`formats.pdf.emptyPages содержит недостижимую позицию ${Math.min(...remaining)} для PDF из ${basePageCount} страниц.`);
  }
  return { baseToFinal };
}

async function finalizePdf(pdfData, { emptyPages, numberedBasePages, baseToFinal, offset, footerBottomCm, horizontalMarginCm, alignment, fontData }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const document = await PDFDocument.load(pdfData);
  const firstPage = document.getPage(0);
  const blankPageSize = [firstPage.getWidth(), firstPage.getHeight()];
  for (const position of emptyPages) document.insertPage(position - 1, blankPageSize);

  if (!numberedBasePages.length) return document.save();
  let font;
  if (fontData) {
    try {
      const { default: fontkit } = await import('@pdf-lib/fontkit');
      document.registerFontkit(fontkit);
      font = await document.embedFont(fontData, { subset: true });
    } catch (error) {
      console.warn(`Предупреждение: не удалось встроить выбранный шрифт номеров страниц: ${error.message}. Используется резервный шрифт.`);
    }
  }
  if (!font) font = await document.embedFont(StandardFonts.TimesRoman);
  const pages = document.getPages();
  for (const basePageNumber of numberedBasePages) {
    const finalPageNumber = baseToFinal[basePageNumber];
    const page = pages[finalPageNumber - 1];
    const label = String(offset + finalPageNumber - 1);
    const fontSize = 9;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const horizontalMargin = horizontalMarginCm * 72 / 2.54;
    const x = alignment === 'outer'
      ? (Number(label) % 2 === 0 ? horizontalMargin : page.getWidth() - horizontalMargin - textWidth)
      : (page.getWidth() - textWidth) / 2;
    page.drawText(label, {
      x,
      y: footerBottomCm * 72 / 2.54,
      size: fontSize,
      font,
      color: rgb(0.07, 0.07, 0.07)
    });
  }
  return document.save();
}

async function loadPdfFonts(settings) {
  const faces = [];
  const regularFonts = new Map();
  for (const font of settings.fonts ?? []) {
    for (const [field, weight, style] of [
      ['regular', 400, 'normal'],
      ['italic', 400, 'italic'],
      ['bold', 700, 'normal'],
      ['boldItalic', 700, 'italic']
    ]) {
      if (!font[field]) continue;
      const loaded = await loadPdfFontFile(font[field], `${font.family} ${field}`);
      if (!loaded) continue;
      faces.push(`    @font-face { font-family: "${escapeCssString(font.family)}"; src: url("data:${loaded.mime};base64,${loaded.data.toString('base64')}") format("${loaded.format}"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`);
      if (field === 'regular') regularFonts.set(font.family, loaded.data);
    }
  }

  if (settings.fontStylesheet) {
    try {
      const path = resolve(bookDir, normalizeAssetPath(settings.fontStylesheet));
      if (!path.startsWith(bookDir + sep) && path !== bookDir) throw new Error('путь выходит за пределы репозитория');
      faces.push(`    /* PDF font stylesheet */\n${await readFile(path, 'utf8')}`);
    } catch (error) {
      console.warn(`Предупреждение: не удалось загрузить formats.pdf.fontStylesheet (${settings.fontStylesheet}): ${error.message}. Используется резервный шрифт.`);
    }
  }

  const bodyFont = settings.bodyFont;
  if (bodyFont) faces.push(`    :root { font-family: "${escapeCssString(bodyFont)}", Georgia, "Times New Roman", serif; }`);
  if (bodyFont && !settings.fontStylesheet && !regularFonts.has(bodyFont)) {
    console.warn(`Предупреждение: regular-файл шрифта "${bodyFont}" для текста не найден. Используется резервный шрифт.`);
  }
  const pageNumberFamily = settings.pageNumbers ? settings.pageNumberFont ?? bodyFont : null;
  if (pageNumberFamily && !regularFonts.has(pageNumberFamily)) {
    console.warn(`Предупреждение: regular-файл шрифта "${pageNumberFamily}" для номеров страниц не найден. Используется резервный шрифт.`);
  }
  return {
    styles: faces.join('\n'),
    pageNumberFontData: pageNumberFamily ? regularFonts.get(pageNumberFamily) ?? null : null
  };
}

async function loadPdfFontFile(relativePath, label) {
  try {
    const path = resolve(bookDir, normalizeAssetPath(relativePath));
    if (!path.startsWith(bookDir + sep) && path !== bookDir) throw new Error('путь выходит за пределы репозитория');
    const extension = extname(path).toLowerCase();
    const types = {
      '.ttf': { mime: 'font/ttf', format: 'truetype' },
      '.otf': { mime: 'font/otf', format: 'opentype' },
      '.woff': { mime: 'font/woff', format: 'woff' },
      '.woff2': { mime: 'font/woff2', format: 'woff2' }
    };
    if (!types[extension]) throw new Error('поддерживаются TTF, OTF, WOFF и WOFF2');
    return { ...types[extension], data: await readFile(path) };
  } catch (error) {
    console.warn(`Предупреждение: не удалось загрузить шрифт ${label} (${relativePath}): ${error.message}. Используется резервный шрифт.`);
    return null;
  }
}

function escapeCssString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function middleHtmlNotes() {
  if (!manuscript.footnotes.length) return '';
  const items = manuscript.footnotes.map(note => `    <aside class="footnote" id="note-${note.number}" role="doc-footnote">\n      <p><span>${note.number}.</span> ${renderMiddleHtmlInline(note.text, manuscript.footnoteNumbers)}</p>\n    </aside>`).join('\n');
  return `\n  <section class="notes" role="doc-endnotes">\n    <h1>Примечания</h1>\n${items}\n  </section>`;
}

async function buildEpub() {
  const settings = config.formats?.epub ?? {};
  const language = settings.language ?? config.language ?? 'ru';
  const publisher = settings.publisher ?? config.formats?.fb2?.publish?.publisher;
  const isbn = settings.isbn ?? config.formats?.fb2?.publish?.isbn;
  const translators = settings.translators ?? config.formats?.fb2?.translators ?? [];
  const titlePageEnabled = settings.titlePage ?? true;
  const tocEnabled = settings.tableOfContents ?? true;
  const bodyImages = await loadBodyImages(manuscript.chapters);
  const cover = await loadImage(settings.cover ?? config.formats?.fb2?.cover, 'cover');
  const identifierHash = createHash('sha256').update(`${config.id ?? config.title}\n${authorName(config.author)}`).digest('hex');
  const identifier = settings.identifier ?? (isbn ? `urn:isbn:${isbn}` : `urn:sha256:${identifierHash}`);
  const modified = settings.modified ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const chapterFiles = manuscript.chapters.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${index + 1}`,
    href: `chapter-${String(index + 1).padStart(2, '0')}.xhtml`
  }));

  const entries = new Map();
  entries.set('META-INF/container.xml', epubContainer());
  entries.set('EPUB/styles.css', await epubStyles(settings));
  entries.set('EPUB/nav.xhtml', epubNavigation(chapterFiles, language, { cover: Boolean(cover), titlePage: titlePageEnabled }));
  if (cover) entries.set('EPUB/cover.xhtml', epubCoverPage(cover, language));
  if (titlePageEnabled) entries.set('EPUB/title.xhtml', epubTitlePage(language, translators));
  for (const chapter of chapterFiles) {
    entries.set(`EPUB/${chapter.href}`, epubChapter(chapter, language, bodyImages));
  }
  if (manuscript.footnotes.length) entries.set('EPUB/notes.xhtml', epubNotes(language));
  for (const image of bodyImages.values()) entries.set(`EPUB/images/${image.id}`, Buffer.from(image.data, 'base64'));
  if (cover) entries.set(`EPUB/images/${cover.id}`, Buffer.from(cover.data, 'base64'));
  entries.set('EPUB/content.opf', epubPackage({
    settings, language, publisher, isbn, translators, identifier, modified, chapterFiles,
    bodyImages, cover, titlePageEnabled, tocEnabled
  }));

  const path = join(outputDir, `${base}.epub`);
  await writeEpubZip(path, entries);
  console.log(`EPUB: ${path}`);
}

function epubContainer() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`;
}

async function epubStyles(settings) {
  if (settings.stylesheet) {
    const path = resolve(bookDir, normalizeAssetPath(settings.stylesheet));
    if (!path.startsWith(bookDir + sep) && path !== bookDir) throw new Error(`Путь EPUB stylesheet выходит за пределы репозитория: ${settings.stylesheet}`);
    return readFile(path, 'utf8');
  }
  return `body { font-family: serif; line-height: 1.5; margin: 5%; }\nh1, h2, h3 { text-align: center; }\np { margin: 0 0 0.7em; text-indent: 1.5em; }\npre { font-family: monospace; white-space: pre-wrap; }\nimg { display: block; max-width: 100%; height: auto; margin: 1em auto; }\nhr.scene-break { width: 20%; margin: 1.75em auto; border: 0; border-top: 1px solid currentColor; }\n.title-page, .cover { text-align: center; }\n.title-page p, .footnotes p { text-indent: 0; }\n`;
}

function epubDocument(title, language, body, extraHead = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">\n<head>\n  <meta charset="UTF-8"/>\n  <title>${escapeXml(title)}</title>\n  <link rel="stylesheet" type="text/css" href="styles.css"/>${extraHead}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function epubNavigation(chapters, language, landmarks) {
  const links = chapters.map(chapter => `      <li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`).join('\n');
  const landmarkLinks = [
    landmarks.cover ? '      <li><a epub:type="cover" href="cover.xhtml">Обложка</a></li>' : '',
    landmarks.titlePage ? '      <li><a epub:type="titlepage" href="title.xhtml">Титульная страница</a></li>' : '',
    chapters.length ? `      <li><a epub:type="bodymatter" href="${chapters[0].href}">Начало текста</a></li>` : ''
  ].filter(Boolean).join('\n');
  return epubDocument('Оглавление', language, `  <nav epub:type="toc" id="toc">\n    <h1>Оглавление</h1>\n    <ol>\n${links}\n    </ol>\n  </nav>\n  <nav epub:type="landmarks" hidden="hidden">\n    <ol>\n${landmarkLinks}\n    </ol>\n  </nav>`);
}

function epubCoverPage(cover, language) {
  return epubDocument(config.title, language, `  <section epub:type="cover" class="cover">\n    <img src="images/${cover.id}" alt="Обложка: ${escapeXml(config.title)}"/>\n  </section>`);
}

function epubTitlePage(language, translators) {
  const translatorRows = translators.map(person => `    <p>Перевод: ${escapeXml(personName(person))}</p>`).join('\n');
  return epubDocument(config.title, language, `  <section epub:type="titlepage" class="title-page">\n    <h1>${escapeXml(config.title)}</h1>\n    <p>${escapeXml(authorName(config.author))}</p>${translatorRows ? `\n${translatorRows}` : ''}\n  </section>`);
}

function epubChapter(chapter, language, images) {
  const body = `  <section epub:type="chapter" id="${chapter.id}">\n    <h1>${escapeXml(chapter.title)}</h1>\n${toEpub(chapter.text, manuscript.footnoteNumbers, images)}\n  </section>`;
  return epubDocument(chapter.title, language, body);
}

function epubNotes(language) {
  const notes = manuscript.footnotes.map(note => `    <aside epub:type="footnote" id="note-${note.number}">\n      <p><span>${note.number}.</span> ${renderEpubInline(note.text, manuscript.footnoteNumbers)}</p>\n    </aside>`).join('\n');
  return epubDocument('Примечания', language, `  <section epub:type="footnotes" class="footnotes">\n    <h1>Примечания</h1>\n${notes}\n  </section>`);
}

function epubPackage({ settings, language, publisher, isbn, translators, identifier, modified, chapterFiles, bodyImages, cover, titlePageEnabled, tocEnabled }) {
  const metadata = [];
  metadata.push(`    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>`);
  metadata.push(`    <dc:title>${escapeXml(config.title)}</dc:title>`);
  metadata.push(`    <dc:language>${escapeXml(language)}</dc:language>`);
  metadata.push(`    <dc:creator id="creator-1">${escapeXml(authorName(config.author))}</dc:creator>`);
  metadata.push('    <meta refines="#creator-1" property="role" scheme="marc:relators">aut</meta>');
  translators.forEach((person, index) => {
    metadata.push(`    <dc:contributor id="translator-${index + 1}">${escapeXml(personName(person))}</dc:contributor>`);
    metadata.push(`    <meta refines="#translator-${index + 1}" property="role" scheme="marc:relators">trl</meta>`);
  });
  if (config.annotation) metadata.push(`    <dc:description>${escapeXml(config.annotation)}</dc:description>`);
  for (const subject of settings.subjects ?? config.genres ?? []) metadata.push(`    <dc:subject>${escapeXml(subject)}</dc:subject>`);
  if (publisher) metadata.push(`    <dc:publisher>${escapeXml(publisher)}</dc:publisher>`);
  if (isbn && identifier !== `urn:isbn:${isbn}`) metadata.push(`    <dc:identifier>${escapeXml(`urn:isbn:${isbn}`)}</dc:identifier>`);
  if (settings.rights) metadata.push(`    <dc:rights>${escapeXml(settings.rights)}</dc:rights>`);
  metadata.push(`    <meta property="dcterms:modified">${escapeXml(modified)}</meta>`);

  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="css" href="styles.css" media-type="text/css"/>`
  ];
  const spine = [];
  if (cover) {
    manifest.push(`    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    manifest.push(`    <item id="cover-image" href="images/${cover.id}" media-type="${cover.mime}" properties="cover-image"/>`);
    spine.push('    <itemref idref="cover-page" linear="no"/>');
  }
  if (titlePageEnabled) {
    manifest.push('    <item id="title-page" href="title.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('    <itemref idref="title-page"/>');
  }
  if (tocEnabled) spine.push('    <itemref idref="nav"/>');
  for (const chapter of chapterFiles) {
    manifest.push(`    <item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`);
    spine.push(`    <itemref idref="${chapter.id}"/>`);
  }
  if (manuscript.footnotes.length) {
    manifest.push('    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('    <itemref idref="notes" linear="no"/>');
  }
  for (const image of bodyImages.values()) manifest.push(`    <item id="resource-${image.id.replace(/[^a-zA-Z0-9_-]/g, '-')}" href="images/${image.id}" media-type="${image.mime}"/>`);

  return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(language)}">\n  <metadata>\n${metadata.join('\n')}\n  </metadata>\n  <manifest>\n${manifest.join('\n')}\n  </manifest>\n  <spine>\n${spine.join('\n')}\n  </spine>\n</package>\n`;
}

async function writeEpubZip(path, entries) {
  const zip = new yazl.ZipFile();
  const epoch = new Date('1980-01-01T00:00:00Z');
  zip.addBuffer(Buffer.from('application/epub+zip', 'ascii'), 'mimetype', { compress: false, mtime: epoch });
  for (const [name, content] of entries) {
    zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), name, { mtime: epoch });
  }

  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(path);
    output.on('close', resolvePromise);
    output.on('error', reject);
    zip.outputStream.on('error', reject).pipe(output);
    zip.end();
  });
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
  const bodyImages = await loadBodyImages(selectedChapters);

  const sections = selectedChapters.map((chapter, i) => `    <section id="chapter-${i + 1}">\n      <title><p>${escapeXml(chapter.title)}</p></title>\n${toFb2(chapter.text, manuscript.footnoteNumbers, bodyImages)}\n    </section>`).join('\n');
  const notesBody = buildFb2Notes(footnotes, manuscript.footnoteNumbers);
  const genres = (settings.genres ?? config.genres ?? ['prose']).map(g => `      <genre>${escapeXml(g)}</genre>`).join('\n');
  const annotation = config.annotation ? `\n      <annotation><p>${escapeXml(config.annotation)}</p></annotation>` : '';
  const keywords = settings.keywords?.length ? `\n      <keywords>${escapeXml(settings.keywords.join(', '))}</keywords>` : '';
  const language = settings.language ?? config.language ?? 'ru';
  const sourceLanguage = settings.sourceLanguage ?? config.sourceLanguage;
  const sourceLanguageXml = sourceLanguage ? `\n      <src-lang>${escapeXml(sourceLanguage)}</src-lang>` : '';
  const translatorsXml = (settings.translators ?? []).map(translator => `\n${fb2Person(translator, 'translator')}`).join('');
  const sequenceXml = sequence?.name ? `\n      <sequence name="${escapeXml(sequence.name)}"${sequence.number != null ? ` number="${escapeXml(sequence.number)}"` : ''}/>` : '';
  const cover = await loadImage(settings.cover, 'cover');
  const coverPage = cover ? `\n      <coverpage><image l:href="#${cover.id}"/></coverpage>` : '';
  const publishInfo = buildPublishInfo(publish, sequence);
  const binaries = [...bodyImages.values(), ...(cover ? [cover] : [])]
    .map(image => `\n  <binary id="${image.id}" content-type="${image.mime}">${image.data}</binary>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n  <description>\n    <title-info>\n${genres}\n${fb2Person(config.author)}\n      <book-title>${escapeXml(config.title)}</book-title>${annotation}${keywords}${coverPage}\n      <lang>${escapeXml(language)}</lang>${sourceLanguageXml}${translatorsXml}${sequenceXml}\n    </title-info>\n    <document-info>\n      <author><nickname>${escapeXml(document.author ?? 'Book Framework')}</nickname></author>\n      <program-used>@nedobylskiy/book-framework</program-used>\n      <date value="${escapeXml(documentDate)}">${escapeXml(documentDate)}</date>\n      <id>${escapeXml(bookId)}</id>\n      <version>${escapeXml(version)}</version>\n    </document-info>${publishInfo}\n  </description>\n  <body>\n${sections}\n  </body>${notesBody}${binaries}\n</FictionBook>\n`;
}

function prepareManuscript(sourceChapters) {
  const definitions = new Map();
  const cleanedChapters = sourceChapters.map(chapter => {
    const lines = chapter.text.split('\n');
    const bodyLines = [];
    let inCode = false;

    for (const line of lines) {
      if (parseFenceLine(line)) {
        inCode = !inCode;
        bodyLines.push(line);
        continue;
      }

      if (!inCode) {
        const match = /^\s*\[\^([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
        if (match) {
          const [, id, text] = match;
          if (definitions.has(id)) throw new Error(`Сноска [^${id}] определена больше одного раза.`);
          definitions.set(id, text);
          continue;
        }
      }

      bodyLines.push(line);
    }

    if (inCode) throw new Error(`В главе ${chapter.file} не закрыт блок кода \`\`\`.`);
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
  const ids = [];
  let inCode = false;
  for (const line of text.split('\n')) {
    if (parseFenceLine(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    for (const match of line.matchAll(/\[\^([^\]]+)\]/g)) ids.push(match[1]);
  }
  return ids;
}

function collectFootnoteRefs(text) {
  return new Set(collectFootnoteRefsInOrder(text));
}

function renderTxtBody(text, footnoteNumbers) {
  const output = [];
  let inCode = false;

  for (const line of text.split('\n')) {
    if (parseFenceLine(line)) {
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      output.push(normalizeCodeLine(line));
      continue;
    }

    if (line.trim() === '---') {
      output.push('', '');
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      output.push(renderTxtInline(heading.text, footnoteNumbers));
      continue;
    }

    const image = parseImageLine(line);
    if (image) {
      output.push(renderTxtImage(image));
      continue;
    }

    output.push(renderTxtInline(line, footnoteNumbers));
  }

  return output.join('\n');
}

function renderTxtImage(image) {
  const target = image.path;
  const baseUrl = config.assets?.baseUrl;
  const url = baseUrl && !isHttpUrl(target) ? joinUrl(baseUrl, target) : target;
  return image.alt ? `${image.alt}: ${url}` : url;
}

function renderTxtInline(text, footnoteNumbers) {
  const tokenPattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([^\]]+)\]/g;
  let output = '';
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    output += text.slice(cursor, match.index);
    if (match[1] != null) output += match[1];
    else if (match[2] != null) output += renderTxtInline(match[2], footnoteNumbers);
    else if (match[3] != null) output += renderTxtInline(match[3], footnoteNumbers);
    else if (match[4] != null) output += match[4] === match[5] ? match[5] : `${match[4]} (${match[5]})`;
    else output += toSuperscript(footnoteNumbers.get(match[6]));
    cursor = match.index + match[0].length;
  }

  output += text.slice(cursor);
  return output;
}

function toSuperscript(number) {
  const digits = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(number).split('').map(digit => digits[digit]).join('');
}

function toFb2(text, footnoteNumbers, images) {
  const output = [];
  let inCode = false;

  for (const line of text.split('\n')) {
    if (parseFenceLine(line)) {
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      const codeLine = normalizeCodeLine(line);
      if (!codeLine.length) output.push('      <empty-line/>');
      else output.push(`      <p><code>${escapeXml(preserveLeadingCodeSpaces(codeLine))}</code></p>`);
      continue;
    }

    if (line.trim() === '---') {
      output.push('      <empty-line/>', '      <empty-line/>');
      continue;
    }
    if (!line.trim()) continue;

    const heading = parseHeadingLine(line);
    if (heading) {
      output.push(`      <subtitle>${renderFb2Inline(heading.text, footnoteNumbers)}</subtitle>`);
      continue;
    }

    const image = parseImageLine(line);
    if (image) {
      if (isHttpUrl(image.path)) throw new Error(`FB2 не может встроить удалённое изображение: ${image.path}. Используйте путь к файлу в репозитории.`);
      const loaded = images.get(normalizeAssetPath(image.path));
      if (!loaded) throw new Error(`Изображение не загружено: ${image.path}`);
      output.push(`      <image l:href="#${loaded.id}"${image.alt ? ` title="${escapeXml(image.alt)}"` : ''}/>`);
      continue;
    }

    output.push(`      <p>${renderFb2Inline(line.trim(), footnoteNumbers)}</p>`);
  }

  return output.join('\n');
}

function renderFb2Inline(text, footnoteNumbers) {
  return renderFb2Range(text, footnoteNumbers);
}

function renderFb2Range(text, footnoteNumbers) {
  const tokenPattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([^\]]+)\]/g;
  let output = '';
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    output += escapeXml(text.slice(cursor, match.index));
    if (match[1] != null) {
      output += `<code>${escapeXml(match[1])}</code>`;
    } else if (match[2] != null) {
      output += `<strong>${renderFb2Range(match[2], footnoteNumbers)}</strong>`;
    } else if (match[3] != null) {
      output += `<emphasis>${renderFb2Range(match[3], footnoteNumbers)}</emphasis>`;
    } else if (match[4] != null) {
      output += `<a l:href="${escapeXml(match[5])}">${escapeXml(match[4])}</a>`;
    } else {
      const id = match[6];
      const number = footnoteNumbers.get(id);
      output += `<a l:href="#note-${number}" type="note">${number}</a>`;
    }
    cursor = match.index + match[0].length;
  }

  output += escapeXml(text.slice(cursor));
  return output;
}

function toEpub(text, footnoteNumbers, images) {
  const output = [];
  let inCode = false;
  let codeLines = [];

  for (const line of text.split('\n')) {
    if (parseFenceLine(line)) {
      if (inCode) {
        output.push(`    <pre><code>${escapeXml(codeLines.map(normalizeCodeLine).join('\n'))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    if (line.trim() === '---') {
      output.push('    <hr class="scene-break"/>');
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      output.push(`    <h${heading.level}>${renderEpubInline(heading.text, footnoteNumbers)}</h${heading.level}>`);
      continue;
    }

    const image = parseImageLine(line);
    if (image) {
      if (isHttpUrl(image.path)) throw new Error(`EPUB не может упаковать удалённое изображение: ${image.path}. Используйте путь к файлу в репозитории.`);
      const loaded = images.get(normalizeAssetPath(image.path));
      if (!loaded) throw new Error(`Изображение не загружено: ${image.path}`);
      output.push(`    <figure><img src="images/${loaded.id}" alt="${escapeXml(image.alt)}"/></figure>`);
      continue;
    }

    output.push(`    <p>${renderEpubInline(line.trim(), footnoteNumbers)}</p>`);
  }

  return output.join('\n');
}

function renderEpubInline(text, footnoteNumbers) {
  const tokenPattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([^\]]+)\]/g;
  let output = '';
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    output += escapeXml(text.slice(cursor, match.index));
    if (match[1] != null) output += `<code>${escapeXml(match[1])}</code>`;
    else if (match[2] != null) output += `<strong>${renderEpubInline(match[2], footnoteNumbers)}</strong>`;
    else if (match[3] != null) output += `<em>${renderEpubInline(match[3], footnoteNumbers)}</em>`;
    else if (match[4] != null) output += `<a href="${escapeXml(match[5])}">${escapeXml(match[4])}</a>`;
    else {
      const number = footnoteNumbers.get(match[6]);
      output += `<a epub:type="noteref" href="notes.xhtml#note-${number}">${number}</a>`;
    }
    cursor = match.index + match[0].length;
  }

  return output + escapeXml(text.slice(cursor));
}

function toMiddleHtml(text, footnoteNumbers, images) {
  const output = [];
  let inCode = false;
  let codeLines = [];

  for (const line of text.split('\n')) {
    if (parseFenceLine(line)) {
      if (inCode) {
        output.push(`      <pre><code>${escapeXml(codeLines.map(normalizeCodeLine).join('\n'))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    if (line.trim() === '---') {
      output.push('      <hr class="scene-break">');
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      output.push(`      <h${heading.level}>${renderMiddleHtmlInline(heading.text, footnoteNumbers)}</h${heading.level}>`);
      continue;
    }

    const image = parseImageLine(line);
    if (image) {
      if (isHttpUrl(image.path)) throw new Error(`Middle HTML не встраивает удалённое изображение: ${image.path}. Используйте путь к файлу в репозитории.`);
      const loaded = images.get(normalizeAssetPath(image.path));
      if (!loaded) throw new Error(`Изображение не загружено: ${image.path}`);
      output.push(`      <figure><img src="data:${loaded.mime};base64,${loaded.data}" alt="${escapeXml(image.alt)}"></figure>`);
      continue;
    }

    output.push(`      <p>${renderMiddleHtmlInline(line.trim(), footnoteNumbers)}</p>`);
  }

  return output.join('\n');
}

function renderMiddleHtmlInline(text, footnoteNumbers) {
  const tokenPattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([^\]]+)\]/g;
  let output = '';
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    output += escapeXml(text.slice(cursor, match.index));
    if (match[1] != null) output += `<code>${escapeXml(match[1])}</code>`;
    else if (match[2] != null) output += `<strong>${renderMiddleHtmlInline(match[2], footnoteNumbers)}</strong>`;
    else if (match[3] != null) output += `<em>${renderMiddleHtmlInline(match[3], footnoteNumbers)}</em>`;
    else if (match[4] != null) output += `<a href="${escapeXml(match[5])}">${escapeXml(match[4])}</a>`;
    else {
      const number = footnoteNumbers.get(match[6]);
      output += `<a role="doc-noteref" href="#note-${number}">${number}</a>`;
    }
    cursor = match.index + match[0].length;
  }

  return output + escapeXml(text.slice(cursor));
}

function buildFb2Notes(footnotes, footnoteNumbers) {
  if (!footnotes.length) return '';
  const sections = footnotes.map(note => `    <section id="note-${note.number}">\n      <title><p>${note.number}</p></title>\n      <p>${renderFb2Inline(note.text, footnoteNumbers)}</p>\n    </section>`).join('\n');
  return `\n  <body name="notes">\n${sections}\n  </body>`;
}

function parseHeadingLine(line) {
  const match = /^\s*(#{2,6})\s+(.+?)\s*$/.exec(line);
  return match ? { level: match[1].length, text: match[2] } : null;
}

function parseFenceLine(line) {
  const match = /^\s*```([A-Za-z0-9_+.-]*)\s*$/.exec(line);
  return match ? { language: match[1] || null } : null;
}

function normalizeCodeLine(line) {
  const normalized = line.replace(/\t/g, '    ');
  return normalized.trim().length ? normalized : '';
}

function preserveLeadingCodeSpaces(line) {
  const match = /^ +/.exec(line);
  if (!match) return line;
  return '\u00A0'.repeat(match[0].length) + line.slice(match[0].length);
}

function parseImageLine(line) {
  const match = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
  return match ? { alt: match[1].trim(), path: match[2].trim() } : null;
}

async function loadBodyImages(selectedChapters) {
  const paths = new Set();
  for (const chapter of selectedChapters) {
    let inCode = false;
    for (const line of chapter.text.split('\n')) {
      if (parseFenceLine(line)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const image = parseImageLine(line);
      if (!image || isHttpUrl(image.path)) continue;
      paths.add(normalizeAssetPath(image.path));
    }
  }

  const images = new Map();
  for (const path of paths) images.set(path, await loadImage(path, 'image'));
  return images;
}

async function loadImage(relativePath, kind = 'image') {
  if (!relativePath) return null;
  if (isHttpUrl(relativePath)) throw new Error(`Для FB2 требуется локальный файл изображения, а не URL: ${relativePath}`);

  const normalized = normalizeAssetPath(relativePath);
  const path = resolve(bookDir, normalized);
  if (!path.startsWith(bookDir + sep) && path !== bookDir) throw new Error(`Путь изображения выходит за пределы репозитория: ${relativePath}`);

  const extension = extname(path).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : null;
  if (!mime) throw new Error(`FB2 поддерживает изображения PNG, JPG или JPEG: ${relativePath}`);

  const data = (await readFile(path)).toString('base64');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  const normalizedExt = extension === '.jpeg' ? '.jpg' : extension;
  return { id: kind === 'cover' ? `cover${normalizedExt}` : `image-${hash}${normalizedExt}`, mime, data, path: normalized };
}

function normalizeAssetPath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function joinUrl(baseUrl, relativePath) {
  return `${baseUrl.replace(/\/+$/, '')}/${normalizeAssetPath(relativePath).replace(/^\/+/, '')}`;
}

function fb2Person(person = {}, tag = 'author') {
  const fields = [];
  if (person.firstName) fields.push(`        <first-name>${escapeXml(person.firstName)}</first-name>`);
  if (person.middleName) fields.push(`        <middle-name>${escapeXml(person.middleName)}</middle-name>`);
  if (person.lastName) fields.push(`        <last-name>${escapeXml(person.lastName)}</last-name>`);
  if (person.nickname) fields.push(`        <nickname>${escapeXml(person.nickname)}</nickname>`);
  if (person.email) fields.push(`        <email>${escapeXml(person.email)}</email>`);
  if (person.homePage) fields.push(`        <home-page>${escapeXml(person.homePage)}</home-page>`);
  return `      <${tag}>\n${fields.join('\n')}\n      </${tag}>`;
}

function personName(person = {}) {
  return authorName(person) || person.nickname || person.email || 'Неизвестный переводчик';
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
