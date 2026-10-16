const db = require('../db');

const CATEGORIES = {
  lash: 'EYELASH EXTENSION',
  threading: 'THREADING SERVICES',
  hairRemoval: 'HAIR REMOVAL (IPL-HR)',
  electrocautery: 'ELECTROCAUTERY (ECT)',
  paraffin: 'PARAFFIN THERAPY',
  foot: 'FOOT TREATMENT',
  dripShot: 'DRIP / SHOT (ED/GS)',
  mesotherapy: 'MESOTHERAPY (MT)',
  hand: 'HAND TREATMENT',
  nail: 'Soft Gel Nail Extensions',
  facial: 'FACIALS',
  chemicalPeel: 'CHEMICAL PEELING (TCA)',
  body: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)'
};

const PRODUCTS = {
  lashSet: ['Wipes', 'Facial Tissue', 'Disposable Mask', 'Latex Gloves (Small)', 'Latex Gloves (Medium)'],
  lashSimple: ['Wipes', 'Facial Tissue'],
  lashRemoval: ['Wipes', 'Facial Tissue', 'Cotton Applicator'],
  threading: ['Cotton Applicator', 'Alcohol', 'Wipes', 'Facial Tissue', 'Latex Gloves (Small)', 'Latex Gloves (Medium)'],
  ipl: ['Shaver', 'Alcohol', 'Wipes', 'EMLA Cream (Topical Anesthetic)'],
  iplFace: ['Shaver', 'Alcohol', 'Wipes', 'Facial Tissue', 'EMLA Cream (Topical Anesthetic)'],
  electrocautery: ['EMLA Cream (Topical Anesthetic)', 'Alcohol', 'Cotton Applicator', 'Gauze', 'Sterile Gauze', 'Wipes', 'Latex Gloves (Small)', 'Latex Gloves (Medium)', 'Disposable Mask'],
  paraffin: ['Wipes', 'Facial Tissue'],
  footSpa: ['Hypo Liquid Soap', 'Hand Soap', 'Wipes'],
  pedicure: ['Alcohol', 'Cotton Roll', 'Cotton Applicator', 'Gauze', 'Wipes'],
  pedicureFootSpa: ['Hypo Liquid Soap', 'Hand Soap', 'Alcohol', 'Cotton Roll', 'Cotton Applicator', 'Wipes'],
  drip: ['Macroset (IV Set)', '10cc Syringe', '3cc Syringe', 'Cannula', 'Scalp Vein Set', 'Sterile Water'],
  shot: ['3cc Syringe', '1cc Syringe', 'Baby Needle', '1cc BD Needle', 'Alcohol', 'Cotton Roll'],
  mesoFace: ['3cc Syringe', '1cc Syringe', 'Baby Needle', '1cc BD Needle', 'Alcohol', 'Cotton Roll', 'Gauze'],
  mesoFaceLift: ['3cc Syringe', '1cc Syringe', 'Baby Needle', '1cc BD Needle', 'Alcohol', 'Cotton Roll', 'RF Cream', 'Ultrasound Gel'],
  mesoBody: ['3cc Syringe', '1cc Syringe', 'Baby Needle', 'Alcohol', 'Cotton Roll', 'Gauze'],
  equipment: ['RF Cream', 'Ultrasound Gel'],
  manicure: ['Alcohol', 'Cotton Roll', 'Cotton Applicator', 'Wipes'],
  nailExtension: ['Alcohol', 'Cotton Roll', 'Cotton Applicator', 'Wipes'],
  gelRemoval: ['Cotton Roll', 'Wipes'],
  facialBasic: ['Toner', 'Facial Scrub', 'Hydra Moist Mask', 'Frozen Mask', 'Facial Tissue', 'Cotton Roll', 'Wipes'],
  facialPeel: ['Toner', 'Facial Scrub', 'Facial Tissue', 'Cotton Roll', 'Wipes'],
  facialLift: ['RF Cream', 'Ultrasound Gel', 'Hydra Moist Mask'],
  signatureFacial: ['Toner', 'Clarifying Toner', 'Facial Scrub', 'Gold Mask', 'Collagen Gold Mask', 'Hydra Moist Mask'],
  acneVulgaris: ['Acne Buster Toner', 'Clarifying Toner', 'Facial Scrub', 'Acne Topical Solution', 'Hydra Moist Mask'],
  acneProgram: ['Acne Buster Toner', 'Clarifying Toner', 'Acne Topical Solution', 'Hydra Moist Mask'],
  microboost: ['Ultrasound Gel', 'RF Cream'],
  facialMicroboost: ['Toner', 'Hydra Moist Mask', 'Ultrasound Gel', 'RF Cream'],
  tca: ['Alcohol', 'Cotton Applicator', 'Gauze', 'Sterile Gauze', 'Wipes', 'EMLA Cream (Topical Anesthetic)'],
  bodyTreatment: ['RF Cream', 'Ultrasound Gel']
};

const NOTES = {
  general: 'Provisional candidate from the supplied mapping list. Confirm actual product use with the clinic before enabling. No default quantity has been assumed.',
  clinical: 'Clinical candidate only. Confirm the clinic protocol and actual product use before enabling. No default quantity has been assumed.',
  ipl: 'Provisional IPL preparation candidate. Confirm the clinic protocol before enabling; EMLA must only be included if the clinic confirms its use. No default quantity has been assumed.',
  peel: 'Provisional TCA candidate. Confirm the clinic protocol before enabling; do not substitute Glycolic products for TCA. EMLA requires clinic confirmation. No default quantity has been assumed.',
  device: 'Provisional device-product candidate. Confirm the product used with the clinic and device before enabling. No default quantity has been assumed.'
};
const LEGACY_INFERRED_NOTE = 'Provisional starting suggestion inferred from service and product names/categories; not a verified clinic procedure. Validate product use and quantity with the clinic.';

const GROUPS = [
  { category: CATEGORIES.lash, serviceNames: ['Classic', 'Hybrid', 'Volume', 'Mega Volume'], products: PRODUCTS.lashSet, note: NOTES.general },
  { category: CATEGORIES.lash, serviceNames: ['Infill'], products: PRODUCTS.lashSimple, note: NOTES.general },
  { category: CATEGORIES.lash, serviceNames: ['Lash Removal'], products: PRODUCTS.lashRemoval, note: NOTES.general },
  { category: CATEGORIES.threading, serviceNames: ['Eyebrow Threading', 'Upper Lip Threading', 'Lower Lip Threading', 'Threading Combo'], products: PRODUCTS.threading, note: NOTES.general },
  { category: CATEGORIES.hairRemoval, serviceNames: ['IPL Hair Removal - Underarms', 'IPL Hair Removal - Bikini Line', 'IPL Hair Removal - Brazilian', 'IPL Hair Removal - Arms', 'IPL Hair Removal - Half Legs / Chest', 'IPL Hair Removal - Full Legs'], products: PRODUCTS.ipl, note: NOTES.ipl },
  { category: CATEGORIES.hairRemoval, serviceNames: ['IPL Hair Removal - Face', 'IPL Hair Removal - Upper Lip'], products: PRODUCTS.iplFace, note: NOTES.ipl },
  { category: CATEGORIES.electrocautery, serviceNames: ['Warts & Milia Removal'], products: PRODUCTS.electrocautery, note: NOTES.clinical },
  { category: CATEGORIES.paraffin, serviceNames: ['Paraffin Hands', 'Paraffin Foot', 'Paraffin Hand & Foot'], products: PRODUCTS.paraffin, note: NOTES.general },
  { category: CATEGORIES.foot, serviceNames: ['Foot Spa'], products: PRODUCTS.footSpa, note: NOTES.general },
  { category: CATEGORIES.foot, serviceNames: ['Pedicure'], products: PRODUCTS.pedicure, note: NOTES.general },
  { category: CATEGORIES.foot, serviceNames: ['Pedicure w/ Foot Spa'], products: PRODUCTS.pedicureFootSpa, note: NOTES.general },
  { category: CATEGORIES.foot, serviceNames: ['Pedicure w/ Foot Spa (Premium)'], products: PRODUCTS.pedicureFootSpa, note: NOTES.general },
  { category: CATEGORIES.dripShot, serviceNames: ['Anti-Aging Drip', 'Immune Booster Drip', 'Slimming Drip', 'Whitening Drip', '3-in-1 Drip', 'Hikari Drip'], products: PRODUCTS.drip, note: NOTES.clinical },
  { category: CATEGORIES.dripShot, serviceNames: ['Gluta Shot w/ Vitamin C', 'Gluta Shot'], products: PRODUCTS.shot, note: NOTES.clinical },
  { category: CATEGORIES.mesotherapy, serviceNames: ['Mesotherapy - Face'], products: PRODUCTS.mesoFace, note: NOTES.clinical },
  { category: CATEGORIES.mesotherapy, serviceNames: ['Mesotherapy - Face w/ V-Lifting'], products: PRODUCTS.mesoFaceLift, note: NOTES.clinical },
  { category: CATEGORIES.mesotherapy, serviceNames: ['Mesotherapy - Arms / Braline', 'Mesotherapy - Tummy', 'Mesotherapy - Thigh'], products: PRODUCTS.mesoBody, note: NOTES.clinical },
  { category: CATEGORIES.mesotherapy, serviceNames: ['Mesotherapy - Whole Body w/ BFR'], products: PRODUCTS.equipment, note: NOTES.device },
  { category: CATEGORIES.hand, serviceNames: ['Manicure', 'Soft Gel Manicure (Gel Polish)'], products: PRODUCTS.manicure, note: NOTES.general },
  { category: CATEGORIES.nail, serviceNames: ['Soft Gel Extensions - Short', 'Soft Gel Extensions - Medium', 'Soft Gel Extensions - Long'], products: PRODUCTS.nailExtension, note: NOTES.general },
  { category: CATEGORIES.nail, serviceNames: ['Gel Polish Removal'], products: PRODUCTS.gelRemoval, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Basic Facial'], products: PRODUCTS.facialBasic, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Diamond Peel'], products: PRODUCTS.facialPeel, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Face V-Lifting'], products: PRODUCTS.facialLift, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['RM Signature Facial'], products: PRODUCTS.signatureFacial, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Acne Vulgaris Facial'], products: PRODUCTS.acneVulgaris, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Acne Treatment Program'], products: PRODUCTS.acneProgram, note: NOTES.general },
  { category: CATEGORIES.facial, serviceNames: ['Microboost'], products: PRODUCTS.microboost, note: NOTES.device },
  { category: CATEGORIES.facial, serviceNames: ['Basic Facial w/ Microboost'], products: PRODUCTS.facialMicroboost, note: NOTES.device },
  { category: CATEGORIES.chemicalPeel, serviceNames: ['TCA Peel - Face / Tummy / Butt', 'TCA Peel - Arms', 'TCA Peel - Underarms / Elbow / Hands', 'TCA Peel - Bikini Line / Knees / Feet / Back', 'TCA Peel - Thigh', 'TCA Peel - Lower Legs', 'TCA Peel - Full Legs', 'TCA Peel - Whole Body'], products: PRODUCTS.tca, note: NOTES.peel },
  { category: CATEGORIES.body, serviceNames: ['Body Tightening - Tummy', 'Body Fat Reduction - Tummy', 'BT w/ BFR - Tummy', 'Body Tightening - Arms', 'Body Fat Reduction - Arms', 'BT w/ BFR - Arms', 'Body Tightening / BFR - Thigh'], products: PRODUCTS.bodyTreatment, note: NOTES.device }
];

const SERVICE_LABELS_NOT_IN_CATALOG = [
  '3-in-1 Facial Oxy (the catalog has a distinct 3-in-1 Facial Drip service; it was not mapped)',
  'Nail Art',
  'Artistic Nails',
  'Rhinestones & Accessories',
  'Standalone Chest hair-removal service (the catalog has a combined Half Legs / Chest service)',
  'Separate Body Tightening - Thigh and Body Fat Reduction - Thigh services (the catalog has one combined Body Tightening / BFR - Thigh service)'
];

function buildCandidates() {
  return GROUPS.flatMap((group) => group.serviceNames.flatMap((serviceName) => (
    group.products.map((productName) => ({
      service_name: serviceName,
      category: group.category,
      product_name: productName,
      review_note: group.note
    }))
  )));
}

async function migrate() {
  const candidates = buildCandidates();
  return db.transaction(async (client) => {
    const table = await client.query(`SELECT to_regclass('service_inventory_product_defaults') AS mapping_table`);
    if (!table.rows[0]?.mapping_table) {
      throw new Error('The service mapping table is missing; apply the approved appointment inventory schema migration first.');
    }

    await client.query(`
      ALTER TABLE service_inventory_product_defaults
      DROP CONSTRAINT IF EXISTS service_inventory_product_defaults_check
    `);

    await client.query(`
      UPDATE service_inventory_product_defaults
      SET default_quantity = NULL,
          is_enabled = FALSE,
          review_note = $1,
          updated_at = NOW()
      WHERE updated_by IS NULL
        AND review_note = $2
    `, [
      'Legacy inferred candidate; clinic must confirm product use before enabling. No default quantity has been assumed.',
      LEGACY_INFERRED_NOTE
    ]);

    const resolution = await client.query(`
      WITH candidates AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb)
          AS candidate(service_name TEXT, category TEXT, product_name TEXT, review_note TEXT)
      )
      SELECT candidate.*,
             (SELECT COUNT(*) FROM services service
              WHERE service.service_name = candidate.service_name
                AND service.category = candidate.category)::INTEGER AS service_matches,
             (SELECT MIN(service.service_id) FROM services service
              WHERE service.service_name = candidate.service_name
                AND service.category = candidate.category) AS service_id,
             (SELECT COUNT(*) FROM inventory_products product
              WHERE product.product_name = candidate.product_name)::INTEGER AS product_matches,
             (SELECT MIN(product.product_id) FROM inventory_products product
              WHERE product.product_name = candidate.product_name) AS product_id
      FROM candidates candidate
      ORDER BY candidate.service_name, candidate.product_name
    `, [JSON.stringify(candidates)]);
    const resolved = resolution.rows.filter((candidate) => (
      candidate.service_matches === 1 && candidate.product_matches === 1
    ));
    const unresolved = resolution.rows.filter((candidate) => (
      candidate.service_matches !== 1 || candidate.product_matches !== 1
    ));

    const inserted = await client.query(`
      INSERT INTO service_inventory_product_defaults
        (service_id, product_id, default_quantity, is_enabled, review_note)
      SELECT candidate.service_id, candidate.product_id, NULL, FALSE, candidate.review_note
      FROM jsonb_to_recordset($1::jsonb)
        AS candidate(service_id INTEGER, product_id INTEGER, review_note TEXT)
      ON CONFLICT (service_id, product_id) DO NOTHING
    `, [JSON.stringify(resolved.map((candidate) => ({
      service_id: candidate.service_id,
      product_id: candidate.product_id,
      review_note: candidate.review_note
    })))]);

    return {
      candidateCount: candidates.length,
      resolvedCount: resolved.length,
      insertedCount: inserted.rowCount,
      unresolved
    };
  });
}

if (require.main === module) {
  migrate()
    .then((result) => {
      console.log(`Appointment inventory candidates resolved: ${result.resolvedCount}/${result.candidateCount}; added ${result.insertedCount} disabled, quantity-unconfirmed mappings.`);
      for (const candidate of result.unresolved) {
        const reason = candidate.service_matches !== 1
          ? `service matched ${candidate.service_matches} rows`
          : `product matched ${candidate.product_matches} rows`;
        console.warn(`Skipped ${candidate.service_name} -> ${candidate.product_name}: ${reason}.`);
      }
      for (const label of SERVICE_LABELS_NOT_IN_CATALOG) {
        console.warn(`No service mapping created for supplied label: ${label}.`);
      }
    })
    .catch((error) => {
      console.error('Appointment inventory mapping migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { buildCandidates, migrate };
