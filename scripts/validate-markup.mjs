import { access } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export async function validateMarkup(chapters, { bookDir = process.cwd() } = {}) {
  const definitions = new Map();
  const referenced = new Set();
  const images = new Set();
  let codeBlocks = 0;

  for (const chapter of chapters) {
    let inCode = false;

    for (const line of chapter.text.split('\n')) {
      if (parseFenceLine(line)) {
        inCode = !inCode;
        if (inCode) codeBlocks += 1;
        continue;
      }

      if (inCode) continue;

      const definition = /^\s*\[\^([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
      if (definition) {
        const [, id] = definition;
        if (definitions.has(id)) throw new Error(`Сноска [^${id}] определена больше одного раза.`);
        definitions.set(id, chapter.file);
        continue;
      }

      for (const match of line.matchAll(/\[\^([^\]]+)\]/g)) referenced.add(match[1]);

      const image = parseImageLine(line);
      if (image && !/^https?:\/\//i.test(image.path)) images.add(image.path);
    }

    if (inCode) throw new Error(`В главе ${chapter.file} не закрыт блок кода \`\`\`.`);
  }

  for (const id of referenced) {
    if (!definitions.has(id)) throw new Error(`Для сноски [^${id}] отсутствует определение [^${id}]: ...`);
  }

  for (const [id, file] of definitions) {
    if (!referenced.has(id)) throw new Error(`Сноска [^${id}] определена в ${file}, но нигде не используется.`);
  }

  for (const image of images) {
    const path = resolve(bookDir, image);
    if (!path.startsWith(bookDir + sep) && path !== bookDir) {
      throw new Error(`Путь изображения выходит за пределы репозитория: ${image}`);
    }

    const extension = extname(path).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
      throw new Error(`Для FB2 поддерживаются изображения PNG, JPG или JPEG: ${image}`);
    }

    try {
      await access(path);
    } catch {
      throw new Error(`Файл изображения не найден: ${image}`);
    }
  }

  return { footnotes: referenced.size, images: images.size, codeBlocks };
}

function parseFenceLine(line) {
  return /^\s*```([A-Za-z0-9_+.-]*)\s*$/.exec(line);
}

function parseImageLine(line) {
  const match = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
  return match ? { alt: match[1].trim(), path: match[2].trim() } : null;
}
