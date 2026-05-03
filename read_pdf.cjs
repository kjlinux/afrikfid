const pdf = require('./node_modules/pdf-parse/lib/pdf-parse.js');
const fs = require('fs');
const buf = fs.readFileSync('CDC GLOBALAFRIKFID V3.pdf');
pdf(buf).then(d => {
  console.log('Pages:', d.numpages);
  console.log(d.text);
}).catch(e => console.error(e));
