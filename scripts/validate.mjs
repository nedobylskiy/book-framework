import { validateBook } from './lib.mjs';

const { config, chapters, universe } = await validateBook();
console.log(`OK: ${config.title}`);
console.log(`Глав: ${chapters.length}`);
console.log(universe ? `Вселенная: ${universe.package} (${universe.path})` : 'Вселенная: не указана');
