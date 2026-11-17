// Calculator tidy 7a, mobile: part thumbnails fit their column instead of covering the part name.
import fs from 'node:fs';
const p = 'site/bureau/rsi1/companion/companion.css';
let css = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
if (css.includes('/* Calculator tidy 7a mobile */')) { console.error('already applied'); process.exit(1); }
if (!css.endsWith('\n')) css += '\n';
css += `
/* Calculator tidy 7a mobile */
.part>.thumb{width:100%;max-width:100%;height:auto;aspect-ratio:56/34;object-fit:cover;min-width:0}
`;
fs.writeFileSync(p, css);
console.log('Mobile thumbnail fix applied.');
