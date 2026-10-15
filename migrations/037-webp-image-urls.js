const db = require('../db');

const pngPaths = [
  'images/AntiAgingTherapyImg.png',
  'images/BodyTightening.png',
  'images/CenterOutsideImg.png',
  'images/ChemicalPeel.png',
  'images/DripShot.png',
  'images/Electrocautery.png',
  'images/EyelashExtension.png',
  'images/FootTreatment.png',
  'images/GSAP Hero.png',
  'images/HairRemoval.png',
  'images/HydratingFacialImg.png',
  'images/logo_horizontal-removebg.png',
  'images/Logo.png',
  'images/Manicure.png',
  'images/Mesotherapy.png',
  'images/NailExtension.png',
  'images/OCRImg.png',
  'images/ParaffinTherapy.png',
  'images/ServicesBackground.png',
  'images/SkinWhiteningImg.png',
  'images/ThreadingService.png',
];

async function migrate() {
  try {
    const webpPaths = pngPaths.map((imagePath) => imagePath.replace(/\.png$/i, '.webp'));
    for (const table of ['homepage_content', 'promotional_announcements']) {
      await db.query(`
        UPDATE ${table}
        SET image_url = regexp_replace(image_url, '\\.png$', '.webp', 'i')
        WHERE lower(image_url) = ANY($1::text[])
      `, [pngPaths.map((imagePath) => imagePath.toLowerCase())]);
    }
    console.log(`Updated stored image paths to WebP (${webpPaths.length} supported assets).`);
  } catch (error) {
    console.error('WebP image URL migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
