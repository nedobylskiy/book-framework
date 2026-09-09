export function validateMarkup(chapters) {
  const definitions = new Map();
  const referenced = new Set();

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
    }
  }

  for (const id of referenced) {
    if (!definitions.has(id)) throw new Error(`Для сноски [^${id}] отсутствует определение [^${id}]: ...`);
  }

  for (const [id, file] of definitions) {
    if (!referenced.has(id)) throw new Error(`Сноска [^${id}] определена в ${file}, но нигде не используется.`);
  }

  return { footnotes: referenced.size };
}
