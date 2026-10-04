const db = require('../db');

const pageContent = [
  { key: 'experience', page: 'home', label: 'Experience Feature', title: 'Experience\nSkin\nGoddess\nGlow', body: 'Work Hours: 09:00 AM – 06:00 PM from Monday to Saturday', image: 'images/CenterOutsideImg.png' },
  { key: 'services_intro', page: 'services', label: 'Services Page Intro', title: 'OUR SERVICES', body: 'All prices are in Philippine Peso (₱). Book for an appointment for a personalized consultation.' },
  { key: 'about_hero', page: 'about', label: 'About Page Heading', title: 'About Skin Goddess', body: 'HOME · ABOUT US' },
  {
    key: 'about_story', page: 'about', label: 'Our Story', title: 'Born from a Passion for Radiant Skin',
    body: 'Skin Goddess Aesthetic Center was founded in 2018 in Las Piñas, Metro Manila, with a simple but powerful belief: every person deserves to feel confident and beautiful in their own skin. What began as a small clinic has grown into a trusted aesthetic center serving hundreds of clients across Metro Manila. Our team of certified specialists combines the latest in aesthetic technology with a deeply personal approach to skin health. We believe that great skin is not a luxury; it is an investment in your confidence. From your very first visit, we tailor every treatment to your unique skin story.',
    image: 'images/SkinGoddessReceptionImg.jpg',
  },
  { key: 'about_team_intro', page: 'about', label: 'Specialists Intro', title: 'Meet the Team Behind Your Glow', body: 'Our certified specialists bring expertise, warmth, and precision to every session dedicated to helping you look and feel your absolute best.' },
  { key: 'contact_hero', page: 'contact', label: 'Contact Page Heading', title: 'Get in Touch', body: 'HOME · CONTACT US' },
  { key: 'contact_message', page: 'contact', label: 'Contact Form Intro', title: "We'd love to hear from you.", body: 'Fill out the form below and our team will get back to you within 24 hours.' },
  { key: 'contact_address', page: 'contact', label: 'Clinic Address', title: 'Skin Goddess Aesthetic Center', body: '2nd Floor KW Plaza Building, Pasong Buaya 2\nImus, Cavite, Philippines, 4103' },
  { key: 'contact_phone', page: 'contact', label: 'Phone & Hours', title: '+63 945 611 9436', body: 'Mon – Sat · 9:00 AM – 6:00 PM' },
  { key: 'contact_email', page: 'contact', label: 'Email Address', title: 'info@skingoddess.ph', body: '' },
];

const categoryImages = {
  eyelash_extension: 'images/EyelashExtension.png',
  paraffin_therapy: 'images/ParaffinTherapy.png',
  hand_treatment: 'images/Manicure.png',
  threading_services: 'images/ThreadingService.png',
  foot_treatment: 'images/FootTreatment.png',
  soft_gel_nail_extensions: 'images/NailExtension.png',
  body_tightening_bt_body_fat_reduction_bfr: 'images/BodyTightening.png',
  drip_shot_ed_gs: 'images/DripShot.png',
  mesotherapy_mt: 'images/Mesotherapy.png',
  facials: 'images/HydratingFacialImg.png',
  hair_removal_ipl_hr: 'images/HairRemoval.png',
  chemical_peeling_tca: 'images/ChemicalPeel.png',
  electrocautery_ect: 'images/Electrocautery.png',
};

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE homepage_content
        ADD COLUMN IF NOT EXISTS page_key VARCHAR(32) NOT NULL DEFAULT 'home',
        ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NOT NULL DEFAULT '';
      CREATE TABLE IF NOT EXISTS website_content_images (
        image_id UUID PRIMARY KEY,
        mime_type VARCHAR(40) NOT NULL,
        image_data BYTEA NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      UPDATE homepage_content
      SET image_url = CASE content_key
        WHEN 'hero' THEN 'images/GSAP Hero.png'
        WHEN 'why_skin_goddess' THEN ''
        WHEN 'about_story' THEN 'images/SkinGoddessReceptionImg.jpg'
        ELSE image_url
      END
      WHERE content_key IN ('hero', 'why_skin_goddess')
        AND (image_url = '' OR content_key = 'why_skin_goddess');
    `);

    for (const [index, item] of pageContent.entries()) {
      await db.query(`
        INSERT INTO homepage_content (content_key, label, title, body, payload, page_key, image_url, is_published, display_order)
        VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6, TRUE, $7)
        ON CONFLICT (content_key) DO NOTHING
      `, [item.key, item.label, item.title, item.body, item.page, item.image || '', index]);
    }

    const categories = await db.query('SELECT DISTINCT category FROM services WHERE category IS NOT NULL ORDER BY category');
    for (const [index, row] of categories.rows.entries()) {
      const category = String(row.category).trim();
      if (!category) continue;
      const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 55);
      const imageUrl = categoryImages[slug] || '';
      await db.query(`
        INSERT INTO homepage_content (content_key, label, title, body, payload, page_key, image_url, is_published, display_order)
        VALUES ($1, $2, $3, '', $4::jsonb, 'services', '', TRUE, $5)
        ON CONFLICT (content_key) DO UPDATE
        SET image_url = CASE WHEN homepage_content.image_url = '' THEN EXCLUDED.image_url ELSE homepage_content.image_url END
      `, [`services_category_${slug}`, `Category Image · ${category}`, category, JSON.stringify({ category }), 10 + index]);
      if (imageUrl) {
        await db.query(`
          UPDATE homepage_content SET image_url = $1
          WHERE content_key = $2 AND image_url = ''
        `, [imageUrl, `services_category_${slug}`]);
      }
    }

    console.log('Page content and image fields are ready.');
  } catch (error) {
    console.error('Page content migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();