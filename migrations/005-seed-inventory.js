const db = require('../db');

const PRODUCTS = [
  // 1. Medical/Injection Supplies
  { name: '1cc Syringe', category: 'Medical/Injection Supplies' },
  { name: '3cc Syringe', category: 'Medical/Injection Supplies' },
  { name: '10cc Syringe', category: 'Medical/Injection Supplies' },
  { name: 'Scalp Vein Set', category: 'Medical/Injection Supplies' },
  { name: 'Baby Needle', category: 'Medical/Injection Supplies' },
  { name: '1cc BD Needle', category: 'Medical/Injection Supplies' },
  { name: 'Cannula', category: 'Medical/Injection Supplies' },
  { name: 'Cartridge', category: 'Medical/Injection Supplies' },
  { name: 'Test Tube', category: 'Medical/Injection Supplies' },
  { name: 'Sterile Water', category: 'Medical/Injection Supplies' },
  { name: 'Macroset (IV Set)', category: 'Medical/Injection Supplies' },

  // 2. Disposables & Clinic Consumables
  { name: 'Bouffant Cap', category: 'Disposables & Clinic Consumables' },
  { name: 'Disposable Mask', category: 'Disposables & Clinic Consumables' },
  { name: 'Latex Gloves (Small)', category: 'Disposables & Clinic Consumables' },
  { name: 'Latex Gloves (Medium)', category: 'Disposables & Clinic Consumables' },
  { name: 'Facial Tissue', category: 'Disposables & Clinic Consumables' },
  { name: 'Toilet Tissue', category: 'Disposables & Clinic Consumables' },
  { name: 'CV/RF Tissue', category: 'Disposables & Clinic Consumables' },
  { name: 'Cotton Roll', category: 'Disposables & Clinic Consumables' },
  { name: 'Cotton Applicator', category: 'Disposables & Clinic Consumables' },
  { name: 'Tongue Depressor', category: 'Disposables & Clinic Consumables' },
  { name: 'Transpore Tape', category: 'Disposables & Clinic Consumables' },
  { name: 'Cling Wrap', category: 'Disposables & Clinic Consumables' },
  { name: 'Gauze', category: 'Disposables & Clinic Consumables' },
  { name: 'Sterile Gauze', category: 'Disposables & Clinic Consumables' },
  { name: 'Wipes', category: 'Disposables & Clinic Consumables' },
  { name: 'Alcohol', category: 'Disposables & Clinic Consumables' },

  // 3. Facial/Treatment Prep Products
  { name: 'Toner', category: 'Facial/Treatment Prep Products' },
  { name: 'Clarifying Toner', category: 'Facial/Treatment Prep Products' },
  { name: 'Acne Buster Toner', category: 'Facial/Treatment Prep Products' },
  { name: 'Glycolic Peeling Toner', category: 'Facial/Treatment Prep Products' },
  { name: 'Hypo Liquid Soap', category: 'Facial/Treatment Prep Products' },
  { name: 'Facial Scrub', category: 'Facial/Treatment Prep Products' },
  { name: 'Hand Soap', category: 'Facial/Treatment Prep Products' },

  // 4. Facial Treatment Products (Professional Use)
  { name: 'Gold Mask', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Collagen Gold Mask', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Hydra Moist Mask', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Frozen Mask', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'RF Cream', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Ultrasound Gel', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Capsugen', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Nee Revive', category: 'Facial Treatment Products (Professional Use)' },
  { name: 'Nee Bright', category: 'Facial Treatment Products (Professional Use)' },

  // 5. Skincare Products (Retail / Aftercare)
  { name: 'Acne Topical Solution', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Erythromycin', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Whitening Cream', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Hydrocortisone', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Glycolic Peel Solution', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Underarm Serum', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Sunblock Gel', category: 'Skincare Products (Retail / Aftercare)' },
  { name: 'Deodorant Spray', category: 'Skincare Products (Retail / Aftercare)' },

  // 6. Soaps & Cleansers
  { name: 'Luna Verde Soap', category: 'Soaps & Cleansers' },
  { name: 'Tea Tree Soap', category: 'Soaps & Cleansers' },
  { name: 'Barley Soap', category: 'Soaps & Cleansers' },
  { name: 'Mallow Soap 100g', category: 'Soaps & Cleansers' },
  { name: 'Mallow Soap 300g', category: 'Soaps & Cleansers' },

  // 7. Tools/Equipment/Misc.
  { name: 'Shaver', category: 'Tools/Equipment/Misc.' },
  { name: 'EMLA Cream (Topical Anesthetic)', category: 'Tools/Equipment/Misc.' }
];

async function seedInventory() {
  try {
    for (const product of PRODUCTS) {
      await db.query(
        `
        INSERT INTO inventory_products
          (product_name, category, stock_quantity, expiry_date)
        VALUES
          ($1, $2, 0, NULL)
        `,
        [product.name, product.category]
      );

      console.log(`Seeded inventory product: ${product.name}`);
    }

    console.log(`Inventory seed completed successfully. ${PRODUCTS.length} products added.`);
  } catch (error) {
    console.error('Inventory seed stopped unexpectedly.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

seedInventory().finally(() => process.exit());