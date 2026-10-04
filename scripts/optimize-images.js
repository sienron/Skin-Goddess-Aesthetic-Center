// Generates WebP versions of the homepage images next to the originals.
// Originals are never modified or deleted. Usage: node scripts/optimize-images.js
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const imagesDir = path.join(__dirname, '..', 'images');
const QUALITY = 80;

const targets = [
  { file: 'GSAP Hero.png', maxWidth: 2400 },
  { file: 'CenterOutsideImg.png', maxWidth: 1920 },
  ...[
    'HydratingFacialImg', 'SkinWhiteningImg', 'AntiAgingTherapyImg', 'EyelashExtension',
    'ParaffinTherapy', 'Manicure', 'ChemicalPeel', 'ThreadingService', 'FootTreatment',
    'NailExtension', 'HairRemoval', 'DripShot', 'BodyTightening', 'Electrocautery', 'Mesotherapy',
  ].map((name) => ({ file: `${name}.png`, maxWidth: 640 })),
];

async function main() {
  let before = 0;
  let after = 0;
  for (const { file, maxWidth } of targets) {
    const source = path.join(imagesDir, file);
    const output = path.join(imagesDir, file.replace(/\.png$/i, '.webp'));
    const info = await sharp(source)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(output);
    const sourceSize = fs.statSync(source).size;
    before += sourceSize;
    after += info.size;
    console.log(`${path.basename(output)}\t${info.width}x${info.height}\t${sourceSize} -> ${info.size} bytes`);
  }
  console.log(`Total: ${before} -> ${after} bytes`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
