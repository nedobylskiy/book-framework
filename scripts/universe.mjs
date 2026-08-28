import { loadConfig, resolveUniverse } from './lib.mjs';

const config = await loadConfig();
const universe = resolveUniverse(config);

if (!universe) {
  throw new Error('Для этой книги вселенная не указана в book.config.json.');
}

console.log(universe.path);
