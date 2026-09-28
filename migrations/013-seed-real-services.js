const db = require('../db');

// Mirrors the treatment categories/prices published on ServicesPage.html so the
// booking dropdown groups real per-area variants instead of one flat list.
const services = [
  // EYELASH EXTENSION
  { category: 'EYELASH EXTENSION', name: 'Classic', description: 'Eyelash extension - Classic', duration: 90, price: 600, fee: 100 },
  { category: 'EYELASH EXTENSION', name: 'Hybrid', description: 'Eyelash extension - Hybrid', duration: 100, price: 800, fee: 100 },
  { category: 'EYELASH EXTENSION', name: 'Volume', description: 'Eyelash extension - Volume', duration: 110, price: 1300, fee: 100 },
  { category: 'EYELASH EXTENSION', name: 'Mega Volume', description: 'Eyelash extension - Mega Volume', duration: 120, price: 1700, fee: 100 },
  { category: 'EYELASH EXTENSION', name: 'Infill', description: 'Eyelash extension - Infill', duration: 60, price: 350, fee: 100 },
  { category: 'EYELASH EXTENSION', name: 'Lash Removal', description: 'Eyelash extension - Removal', duration: 30, price: 500, fee: 100 },

  // PARAFFIN THERAPY
  { category: 'PARAFFIN THERAPY', name: 'Paraffin Hands', description: 'Paraffin therapy - Hands', duration: 30, price: 299, fee: 100 },
  { category: 'PARAFFIN THERAPY', name: 'Paraffin Foot', description: 'Paraffin therapy - Foot', duration: 30, price: 349, fee: 100 },
  { category: 'PARAFFIN THERAPY', name: 'Paraffin Hand & Foot', description: 'Paraffin therapy - Hand & Foot', duration: 45, price: 599, fee: 100 },

  // HAND TREATMENT
  { category: 'HAND TREATMENT', name: 'Manicure', description: 'Hand treatment - Manicure', duration: 30, price: 199, fee: 100 },
  { category: 'HAND TREATMENT', name: 'Soft Gel Manicure (Gel Polish)', description: 'Hand treatment - Soft gel manicure with gel polish', duration: 60, price: 650, fee: 100 },

  // THREADING SERVICES
  { category: 'THREADING SERVICES', name: 'Eyebrow Threading', description: 'Threading - Eyebrow', duration: 15, price: 200, fee: 100 },
  { category: 'THREADING SERVICES', name: 'Upper Lip Threading', description: 'Threading - Upper lip', duration: 15, price: 200, fee: 100 },
  { category: 'THREADING SERVICES', name: 'Lower Lip Threading', description: 'Threading - Lower lip', duration: 15, price: 200, fee: 100 },
  { category: 'THREADING SERVICES', name: 'Threading Combo', description: 'Threading - Eyebrow, upper lip & lower lip combo', duration: 30, price: 500, fee: 100 },

  // FOOT TREATMENT
  { category: 'FOOT TREATMENT', name: 'Foot Spa', description: 'Foot treatment - Foot spa', duration: 45, price: 399, fee: 100 },
  { category: 'FOOT TREATMENT', name: 'Pedicure', description: 'Foot treatment - Pedicure', duration: 45, price: 299, fee: 100 },
  { category: 'FOOT TREATMENT', name: 'Pedicure w/ Foot Spa', description: 'Foot treatment - Pedicure with foot spa', duration: 60, price: 649, fee: 100 },
  { category: 'FOOT TREATMENT', name: 'Pedicure w/ Foot Spa (Premium)', description: 'Foot treatment - Premium pedicure with foot spa', duration: 75, price: 799, fee: 100 },

  // Soft Gel Nail Extensions
  { category: 'Soft Gel Nail Extensions', name: 'Soft Gel Extensions - Short', description: 'Soft gel nail extensions - Short length', duration: 60, price: 1300, fee: 100 },
  { category: 'Soft Gel Nail Extensions', name: 'Soft Gel Extensions - Medium', description: 'Soft gel nail extensions - Medium length', duration: 75, price: 1500, fee: 100 },
  { category: 'Soft Gel Nail Extensions', name: 'Soft Gel Extensions - Long', description: 'Soft gel nail extensions - Long length', duration: 90, price: 1800, fee: 100 },
  { category: 'Soft Gel Nail Extensions', name: 'Gel Polish Removal', description: 'Soft gel nail extensions - Gel polish removal', duration: 20, price: 250, fee: 100 },

  // BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'Body Tightening - Tummy', description: 'Body tightening - Tummy', duration: 45, price: 2000, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'Body Fat Reduction - Tummy', description: 'Body fat reduction - Tummy', duration: 45, price: 2000, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'BT w/ BFR - Tummy', description: 'Body tightening with fat reduction - Tummy', duration: 60, price: 4000, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'Body Tightening - Arms', description: 'Body tightening - Arms', duration: 30, price: 1300, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'Body Fat Reduction - Arms', description: 'Body fat reduction - Arms', duration: 30, price: 1300, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'BT w/ BFR - Arms', description: 'Body tightening with fat reduction - Arms', duration: 45, price: 2000, fee: 100 },
  { category: 'BODY TIGHTENING (BT) / BODY FAT REDUCTION (BFR)', name: 'Body Tightening / BFR - Thigh', description: 'Body tightening / fat reduction - Thigh', duration: 60, price: 2400, fee: 100 },

  // DRIP / SHOT (ED/GS)
  { category: 'DRIP / SHOT (ED/GS)', name: 'Anti-Aging Drip', description: 'Drip / shot - Anti-aging drip', duration: 45, price: 3000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Immune Booster Drip', description: 'Drip / shot - Immune booster drip', duration: 45, price: 3000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Slimming Drip', description: 'Drip / shot - Slimming drip', duration: 45, price: 3000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Whitening Drip', description: 'Drip / shot - Whitening drip', duration: 45, price: 3000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: '3-in-1 Drip', description: 'Drip / shot - 3-in-1 drip', duration: 60, price: 4000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Gluta Shot w/ Vitamin C', description: 'Drip / shot - Gluta shot with vitamin C', duration: 30, price: 2000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Gluta Shot', description: 'Drip / shot - Gluta shot', duration: 30, price: 1000, fee: 100 },
  { category: 'DRIP / SHOT (ED/GS)', name: 'Hikari Drip', description: 'Drip / shot - Hikari drip', duration: 60, price: 4500, fee: 100 },

  // MESOTHERAPY (MT)
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Face', description: 'Mesotherapy - Face', duration: 30, price: 3000, fee: 100 },
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Face w/ V-Lifting', description: 'Mesotherapy - Face with V-lifting', duration: 45, price: 3000, fee: 100 },
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Arms / Braline', description: 'Mesotherapy - Arms / braline', duration: 45, price: 5000, fee: 100 },
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Tummy', description: 'Mesotherapy - Tummy', duration: 45, price: 5000, fee: 100 },
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Thigh', description: 'Mesotherapy - Thigh', duration: 45, price: 5000, fee: 100 },
  { category: 'MESOTHERAPY (MT)', name: 'Mesotherapy - Whole Body w/ BFR', description: 'Mesotherapy - Whole body with BFR', duration: 90, price: 30000, fee: 100 },

  // FACIALS
  { category: 'FACIALS', name: 'Basic Facial', description: 'Facial - Basic facial', duration: 60, price: 1000, fee: 100 },
  { category: 'FACIALS', name: 'Diamond Peel', description: 'Facial - Diamond peel', duration: 60, price: 1000, fee: 100 },
  { category: 'FACIALS', name: 'Face V-Lifting', description: 'Facial - Face V-lifting', duration: 60, price: 1000, fee: 100 },
  { category: 'FACIALS', name: 'RM Signature Facial', description: 'Facial - RM signature facial', duration: 75, price: 1500, fee: 100 },
  { category: 'FACIALS', name: 'Acne Vulgaris Facial', description: 'Facial - Acne vulgaris facial', duration: 75, price: 1500, fee: 100 },
  { category: 'FACIALS', name: '3-in-1 Facial Drip', description: 'Facial - 3-in-1 facial drip', duration: 90, price: 4500, fee: 100 },
  { category: 'FACIALS', name: 'Microboost', description: 'Facial - Microboost', duration: 90, price: 4500, fee: 100 },
  { category: 'FACIALS', name: 'Basic Facial w/ Microboost', description: 'Facial - Basic facial with microboost', duration: 90, price: 5000, fee: 100 },
  { category: 'FACIALS', name: 'Acne Treatment Program', description: 'Facial - Acne treatment program', duration: 90, price: 7500, fee: 100 },

  // HAIR REMOVAL (IPL-HR)
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Underarms', description: 'Hair removal (IPL-HR) - Underarms', duration: 15, price: 2000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Bikini Line', description: 'Hair removal (IPL-HR) - Bikini line', duration: 20, price: 2000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Face', description: 'Hair removal (IPL-HR) - Face', duration: 20, price: 2000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Upper Lip', description: 'Hair removal (IPL-HR) - Upper lip', duration: 10, price: 2000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Brazilian', description: 'Hair removal (IPL-HR) - Brazilian', duration: 30, price: 4000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Arms', description: 'Hair removal (IPL-HR) - Arms', duration: 30, price: 4000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Half Legs / Chest', description: 'Hair removal (IPL-HR) - Half legs / chest', duration: 30, price: 4000, fee: 100 },
  { category: 'HAIR REMOVAL (IPL-HR)', name: 'IPL Hair Removal - Full Legs', description: 'Hair removal (IPL-HR) - Full legs', duration: 60, price: 10000, fee: 100 },

  // CHEMICAL PEELING (TCA)
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Face / Tummy / Butt', description: 'Chemical peeling (TCA) - Face / tummy / butt', duration: 30, price: 2000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Arms', description: 'Chemical peeling (TCA) - Arms', duration: 30, price: 3000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Underarms / Elbow / Hands', description: 'Chemical peeling (TCA) - Underarms / elbow / hands', duration: 30, price: 2000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Bikini Line / Knees / Feet / Back', description: 'Chemical peeling (TCA) - Bikini line / knees / feet / back', duration: 30, price: 2000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Thigh', description: 'Chemical peeling (TCA) - Thigh', duration: 45, price: 4000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Lower Legs', description: 'Chemical peeling (TCA) - Lower legs', duration: 45, price: 4000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Full Legs', description: 'Chemical peeling (TCA) - Full legs', duration: 60, price: 6000, fee: 100 },
  { category: 'CHEMICAL PEELING (TCA)', name: 'TCA Peel - Whole Body', description: 'Chemical peeling (TCA) - Whole body', duration: 90, price: 30000, fee: 100 },

  // ELECTROCAUTERY (ECT)
  { category: 'ELECTROCAUTERY (ECT)', name: 'Warts & Milia Removal', description: 'Electrocautery (ECT) - Warts & milia removal', duration: 30, price: 3000, fee: 100 }
];

async function migrate() {
  try {
    await db.query(`UPDATE services SET is_active = false WHERE service_name = 'Local Test Service'`);

    for (const service of services) {
      await db.query(
        `INSERT INTO services (service_name, category, description, duration_minutes, service_price, reservation_fee, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (service_name) DO UPDATE SET
           category = EXCLUDED.category,
           description = EXCLUDED.description,
           duration_minutes = EXCLUDED.duration_minutes,
           service_price = EXCLUDED.service_price,
           reservation_fee = EXCLUDED.reservation_fee,
           is_active = true,
           updated_at = NOW()`,
        [service.name, service.category, service.description, service.duration, service.price, service.fee]
      );
    }

    console.log(`Seeded ${services.length} real services across their treatment categories.`);
  } catch (error) {
    console.error('Real services seed migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
