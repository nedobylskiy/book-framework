import { validateBook } from './lib.mjs';
import { validateMarkup } from './validate-markup.mjs';

const { bookDir, config, chapters, universe } = await validateBook();
const markup = await validateMarkup(chapters, { bookDir });

console.log(`OK: ${config.title}`);
console.log(`Глав: ${chapters.length}`);
console.log(`Сносок: ${markup.footnotes}`);
console.log(`Изображений: ${markup.images}`);
console.log(`Блоков кода: ${markup.codeBlocks}`);
console.log(universe ? `Вселенная: ${universe.package} (${universe.path})` : 'Вселенная: не указана');
