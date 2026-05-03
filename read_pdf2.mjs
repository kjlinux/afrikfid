import { PDFParse } from './node_modules/pdf-parse/dist/pdf-parse/esm/PDFParse.js';
import { readFileSync } from 'fs';

const buf = readFileSync('CDC GLOBALAFRIKFID V3.pdf');
const parser = new PDFParse({ verbosity: 0 });
const result = await parser.parse(buf);
console.log(result.text);
