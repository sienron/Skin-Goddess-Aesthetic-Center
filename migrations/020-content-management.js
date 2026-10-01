const db = require('../db');

const homepageContent = [
  {
    key: 'hero', label: 'Hero Section', title: 'Healthy Skin.\nConfident You.',
    body: 'Trusted skincare and aesthetic treatments, tailored to you at Skin-Goddess Aesthetic Center.', payload: {},
  },
  {
    key: 'services_strip', label: 'Services Strip', title: 'Services at a glance',
    body: 'Four quick links to the clinic\'s most requested services.',
    payload: { items: [
      { title: 'Facial Treatments', body: 'Deep cleansing and hydrating facials for every skin type.' },
      { title: 'Skin Whitening', body: 'Science-backed brightening for a luminous, even complexion.' },
      { title: 'Anti-Aging', body: 'Advanced collagen-boosting and wrinkle-reduction therapies.' },
      { title: 'Laser Therapy', body: 'Precision laser for pigmentation, acne scars and resurfacing.' },
    ] },
  },
  {
    key: 'treatments_intro', label: 'Featured Treatments Carousel', title: 'Tailored Care for',
    body: 'Every Skin Story', payload: {},
  },
  {
    key: 'why_skin_goddess', label: 'Why Skin Goddess', title: 'Streamlined Care, Effortless Experience',
    body: 'Our clinic pairs expert care with seamless online booking so you focus only on your glow.', payload: {},
  },
  {
    key: 'newsletter', label: 'Subscribe / Newsletter Banner', title: 'Join Our Newsletter',
    body: 'Skincare tips, exclusive offers, and clinic updates delivered straight to your inbox. No spam, ever.', payload: {},
  },
];

const teamMembers = [
  ['Ms. Dian Diada', 'Finance & Expense Reporting'],
  ['Ms. Dona Dacuno', 'Inventory & Procurement Officer'],
  ['Ms. Honeylet D. Martus', 'Clinic Cleanliness & Machine Maintenance Officer'],
  ['Ms. Gerasel Ragudo', 'Head Aesthetician & Training Supervisor'],
  ['Ms. Jade Arevalo', 'Policy Implementation, Income Reporting & Fund Management Officer'],
  ['Nail Tech', 'Nail Technician'],
  ['Mr. John Paul Cabrera', 'Administrator'],
];

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS homepage_content (
        content_key VARCHAR(80) PRIMARY KEY,
        label VARCHAR(160) NOT NULL,
        title VARCHAR(500) NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS website_team_members (
        team_member_id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        role VARCHAR(160) NOT NULL,
        specialty TEXT NOT NULL DEFAULT '',
        experience TEXT NOT NULL DEFAULT '',
        photo_url VARCHAR(500) NOT NULL DEFAULT 'images/SkinGoddessReceptionImg.jpg',
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    for (const [index, item] of homepageContent.entries()) {
      await db.query(`
        INSERT INTO homepage_content (content_key, label, title, body, payload, display_order)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (content_key) DO NOTHING
      `, [item.key, item.label, item.title, item.body, JSON.stringify(item.payload), index]);
    }

    for (const [index, [name, role]] of teamMembers.entries()) {
      await db.query(`
        INSERT INTO website_team_members (name, role, sort_order)
        SELECT $1::varchar, $2::varchar, $3::integer
        WHERE NOT EXISTS (SELECT 1 FROM website_team_members WHERE name = $1::varchar)
      `, [name, role, index]);
    }

    console.log('Content management tables and starter content are ready.');
  } catch (error) {
    console.error('Content management migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());