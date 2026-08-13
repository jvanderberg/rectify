const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const build = JSON.parse(read('version.json')).build;
const expectations = [
  ['index.html', `window.RECTIFY_BUILD='${build}'`],
  ['index.html', `styles.css?v=${build}`],
  ['index.html', `detector.js?v=${build}`],
  ['index.html', `app.js?v=${build}`],
  ['manifest.webmanifest', `./?v=${build}`],
  ['sw.js', `const BUILD='${build}'`]
];
for (const [file, needle] of expectations) {
  if (!read(file).includes(needle)) throw new Error(`${file} is not stamped with build ${build}`);
}
console.log(`Cache version ${build} is consistent across ${expectations.length} references.`);
