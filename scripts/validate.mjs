import { validateBook } from './lib.mjs';

const { config, chapters } = await validateBook();
console.log(`OK: ${config.title}`);
console.log(`Глав: ${chapters.length}`);
