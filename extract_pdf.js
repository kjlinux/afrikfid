const zlib = require('zlib');
const fs = require('fs');
const buf = fs.readFileSync('CDC GLOBALAFRIKFID V3.pdf');

let pos = 0;
const str = buf.toString('binary');
let allText = '';

while (true) {
  const flate = str.indexOf('/FlateDecode', pos);
  if (flate === -1) break;
  const sStart = str.indexOf('stream', flate) + 6;
  let dataStart = sStart;
  if (str[dataStart] === '\r') dataStart++;
  if (str[dataStart] === '\n') dataStart++;
  const sEnd = str.indexOf('endstream', dataStart);
  if (sEnd === -1) break;

  const compressed = buf.slice(dataStart, sEnd);
  try {
    const decompressed = zlib.inflateSync(compressed).toString('latin1');
    allText += decompressed + '\n';
  } catch(e) {}
  pos = sEnd + 9;
}

// Extract text from Tj operator
let readable = '';
let i = 0;
while (i < allText.length) {
  if (allText[i] === '(' ) {
    let j = i + 1;
    let s = '';
    while (j < allText.length && allText[j] !== ')') {
      if (allText[j] === '\\') { j++; s += allText[j] || ''; }
      else s += allText[j];
      j++;
    }
    const after = allText.slice(j+1, j+5).trim();
    if (after.startsWith('Tj') || after.startsWith('TJ')) {
      readable += s;
    }
    i = j + 1;
  } else {
    if (allText[i] === '\n') readable += '\n';
    i++;
  }
}

console.log(readable.slice(0, 30000));
