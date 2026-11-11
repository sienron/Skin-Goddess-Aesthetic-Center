const sharp = require('sharp');

sharp('Finance Module Flowchart.svg')
  .png({ compressionLevel: 9 })
  .toFile('Finance Module Flowchart.png')
  .then(() => console.log('Finance Module Flowchart.png'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
