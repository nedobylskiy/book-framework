#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

const help = `Book Framework CLI

Usage:
  book build [--format txt|fb2]
  book validate
  book new-chapter <slug> [--title "Chapter title"]
  book help
`;

switch (command) {
  case 'build':
    process.argv = [process.argv[0], process.argv[1], ...args];
    await import('../scripts/build.mjs');
    break;
  case 'validate':
    await import('../scripts/validate.mjs');
    break;
  case 'new-chapter':
    process.argv = [process.argv[0], process.argv[1], ...args];
    await import('../scripts/new-chapter.mjs');
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(help);
    break;
  default:
    console.error(`Неизвестная команда: ${command}\n`);
    console.error(help);
    process.exitCode = 1;
}
