import { access } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export async function validateMarkup(chapters, { bookDir = process.cwd() } = {}) {
  const definitions = new Map();
  const referenced = new Set();
  const images = new Set();

  for (const chapter of chapters) {
    for (const line of chapter.text.split('\n')) {
      const definition = /^\s*\[\^([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
      if (definition) {
        const [, id] = definition;
        if (definitions.has(id)) throw new Error(`Сноска [^${id}] определена больше одного раза.`);
        definitions.set(id, chapter.file);
        continue;
      }

      for (const match of line.matchAll(/\[\^([^\]]+)\]/g)) referenced.add(match[1]);

      const image = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
      if (image && !/^https?:\/\//i.test(image[2].trim())) images.add(image[2].trim());
    }
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

  return { footnotes: referenced.size, images: images.size };
}
