import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { readFileSync } from 'fs';

const buf = readFileSync('CDC GLOBALAFRIKFID V3.pdf');
const data = await pdfParse(buf);
console.log('Pages:', data.numpages);
console.log(data.text);
