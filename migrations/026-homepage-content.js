const db = require('../db');

const homepageContent = [
  {
    key: 'home_feature_certified', label: 'Certified Specialists', title: 'Certified Specialists',
    body: 'Our treatments are performed by trained and certified specialists who understand the importance of proper technique, safety, and attention to detail. With professional knowledge and experience, our team works carefully to provide treatments that are suited to your skin while helping you feel comfortable and confident throughout every session.',
    image: 'images/stock-team.webp',
  },
  {
    key: 'home_feature_personalized', label: 'Personalized Plans', title: 'Personalized Plans',
    body: 'Every skin is unique, and your treatment plan should be too. We take the time to understand your skin concerns, goals, and preferences before recommending treatments that fit your individual needs. This personalized approach helps ensure that every session is purposeful and suited to your skin.',
    image: 'images/4.webp',
  },
  {
    key: 'home_feature_premium', label: 'Premium Products', title: 'Premium Products',
    body: 'We use carefully selected, high-quality products as part of our commitment to safe and effective skincare. Each product is chosen with your skin’s needs in mind, helping support the treatment process while providing the care your skin deserves before, during, and after your appointment.',
    image: 'images/stock-products.webp',
  },
  {
    key: 'home_feature_support', label: 'Ongoing Support', title: 'Ongoing Support',
    body: "Your skincare journey doesn't end when your treatment is finished. We provide aftercare guidance and follow-up consultations to help you understand how to care for your skin, maintain your results, and address any concerns that may arise after your session.",
    image: 'images/stock-aftercare.webp',
  },
  {
    key: 'home_testimonials_intro', label: 'Testimonials Heading', title: 'Real Results, Real Confidence',
    body: 'See what the community is saying about Skin Goddess',
  },
  {
    key: 'home_treatment_hydrating_facial', label: 'Hydrating Facial', title: 'Hydrating Facial',
    body: 'A deep-cleansing, moisture-rich facial that restores radiance and softness. Suitable for all skin types.',
    image: 'images/HydratingFacialImg.png',
  },
  {
    key: 'home_treatment_skin_whitening', label: 'Skin Whitening', title: 'Skin Whitening',
    body: 'Science-backed brightening that targets dark spots and uneven tone for a luminous, radiant finish.',
    image: 'images/SkinWhiteningImg.png',
  },
  {
    key: 'home_treatment_anti_aging_therapy', label: 'Anti-Aging Therapy', title: 'Anti-Aging Therapy',
    body: "Advanced collagen-stimulating treatments that reduce fine lines and restore your skin's natural youthfulness.",
    image: 'images/AntiAgingTherapyImg.png',
  },
  {
    key: 'home_treatment_eyelash_extension', label: 'Eyelash Extension', title: 'Eyelash Extension',
    body: 'Full lash sets from classic to mega volume for a fuller, more dramatic lash look. Infill and removal services are also available for maintenance.',
    image: 'images/EyelashExtension.png',
  },
  {
    key: 'home_treatment_paraffin_therapy', label: 'Paraffin Therapy', title: 'Paraffin Therapy',
    body: 'A warm paraffin wax treatment for hands and feet that softens skin and soothes joints. Great as a quick add-on or standalone relaxation service.',
    image: 'images/ParaffinTherapy.png',
  },
  {
    key: 'home_treatment_hand_treatment', label: 'Hand Treatment', title: 'Hand Treatment',
    body: 'Classic and soft gel manicure services to keep nails clean and well-groomed. Ideal for regular upkeep or special occasions.',
    image: 'images/Manicure.png',
  },
  {
    key: 'home_treatment_chemical_peeling_tca', label: 'Chemical Peeling (TCA)', title: 'Chemical Peeling (TCA)',
    body: 'TCA peels that target uneven skin tone and texture across the face and body. Areas range from small zones like elbows to full-body treatments.',
    image: 'images/ChemicalPeel.png',
  },
  {
    key: 'home_treatment_threading_services', label: 'Threading Services', title: 'Threading Services',
    body: 'Precise hair removal for eyebrows, upper lip, and lower lip using traditional threading. A quick, low-irritation option for facial hair grooming.',
    image: 'images/ThreadingService.png',
  },
  {
    key: 'home_treatment_foot_treatment', label: 'Foot Treatment', title: 'Foot Treatment',
    body: 'Foot spa and pedicure services designed to relax and refresh tired feet. Add-on foot spa options are available for a more indulgent experience.',
    image: 'images/FootTreatment.png',
  },
  {
    key: 'home_treatment_soft_gel_nail_extensions', label: 'Soft Gel Nail Extensions', title: 'Soft Gel Nail Extensions',
    body: 'Durable soft gel extensions available in short, medium, and long lengths. Nail art, rhinestones, and other add-ons can enhance the final look.',
    image: 'images/NailExtension.png',
  },
  {
    key: 'home_treatment_hair_removal_ipl_hr', label: 'Hair Removal (IPL-HR)', title: 'Hair Removal (IPL-HR)',
    body: 'IPL-based hair removal for targeted areas like underarms and bikini line up to full-body sessions. A long-term solution for smoother, hair-free skin.',
    image: 'images/HairRemoval.png',
  },
  {
    key: 'home_treatment_drip_shot_ed_gs', label: 'Drip / Shot (ED/GS)', title: 'Drip / Shot (ED/GS)',
    body: 'IV drips and shots formulated for anti-aging, immune support, slimming, and whitening. Delivers nutrients directly for faster, noticeable results.',
    image: 'images/DripShot.png',
  },
  {
    key: 'home_treatment_facials', label: 'Facials', title: 'Facials',
    body: 'A range of facials from basic cleansing to advanced treatments like diamond peel and acne programs. Customizable based on skin concerns and goals.',
    image: 'images/HydratingFacialImg.png',
  },
  {
    key: 'home_treatment_tightening_bt_body_fat_reduction', label: 'Tightening (BT) / Body Fat Reduction', title: 'Tightening (BT) / Body Fat Reduction',
    body: 'Body tightening and fat reduction treatments for the tummy, arms, and thighs. Can be combined with BFR for enhanced contouring results.',
    image: 'images/BodyTightening.png',
  },
  {
    key: 'home_treatment_electrocautery_ect', label: 'Electrocautery (ECT)', title: 'Electrocautery (ECT)',
    body: 'A precise method for removing warts and milia using controlled heat. A quick, in-clinic procedure with minimal downtime.',
    image: 'images/Electrocautery.png',
  },
  {
    key: 'home_treatment_mesotherapy_mt', label: 'Mesotherapy (MT)', title: 'Mesotherapy (MT)',
    body: 'Injectable treatments targeting the face, arms, tummy, thighs, or full body for tightening and rejuvenation. Includes BFR-enhanced whole-body options for deeper results.',
    image: 'images/Mesotherapy.png',
  },
];

async function migrate() {
  try {
    for (const [index, item] of homepageContent.entries()) {
      await db.query(`
        INSERT INTO homepage_content (content_key, label, title, body, payload, page_key, image_url, is_published, display_order)
        VALUES ($1, $2, $3, $4, $5::jsonb, 'home', $6, TRUE, $7)
        ON CONFLICT (content_key) DO NOTHING
      `, [
        item.key,
        item.label,
        item.title,
        item.body,
        JSON.stringify(item.payload || {}),
        item.image || '',
        20 + index,
      ]);
    }

    await db.query(`
      UPDATE homepage_content SET image_url = ''
      WHERE content_key = 'hero' AND image_url <> ''
    `);
    await db.query(`
      UPDATE homepage_content
      SET payload = payload || $1::jsonb
      WHERE content_key = 'hero'
        AND NOT (payload ? 'eyebrow')
    `, [JSON.stringify({ eyebrow: 'EXPERT CARE. GLOWING RESULTS.' })]);
    await db.query(`
      UPDATE homepage_content
      SET payload = payload || $1::jsonb
      WHERE content_key = 'treatments_intro'
        AND NOT (payload ? 'eyebrow')
    `, [JSON.stringify({ eyebrow: 'OUR TREATMENTS' })]);
    await db.query(`
      UPDATE homepage_content
      SET payload = payload || $1::jsonb
      WHERE content_key = 'newsletter'
        AND NOT (payload ? 'eyebrow')
    `, [JSON.stringify({ eyebrow: 'STAY IN THE GLOW' })]);
    await db.query(`
      UPDATE homepage_content
      SET image_url = 'images/CenterOutsideImg.webp'
      WHERE content_key = 'newsletter' AND image_url = ''
    `);

    console.log('Homepage content blocks are ready.');
  } catch (error) {
    console.error('Homepage content migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
