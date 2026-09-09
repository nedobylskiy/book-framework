import { validateBook } from './lib.mjs';
import { validateMarkup } from './validate-markup.mjs';

const { config, chapters, universe } = await validateBook();
const markup = validateMarkup(chapters);

console.log(`OK: ${config.title}`);
console.log(`Глав: ${chapters.length}`);
console.log(`Сносок: ${markup.footnotes}`);
console.log(universe ? `Вселенная: ${universe.package} (${universe.path})` : 'Вселенная: не указана');
