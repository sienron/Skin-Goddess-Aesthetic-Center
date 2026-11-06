const db = require('../db');

async function migrate() {
  try {
    const result = await db.transaction(async (client) => {
      const users = await client.query(`
        UPDATE users
        SET role = 'aesthetician', updated_at = NOW()
        WHERE role = 'nail_tech'
        RETURNING user_id
      `);

      const seededAccount = await client.query(`
        UPDATE users
        SET first_name = 'Second', last_name = 'Aesthetician', updated_at = NOW()
        WHERE LOWER(email) = LOWER('skingoddess.nailtech@gmail.com')
          AND role = 'aesthetician'
          AND first_name = 'Nail'
          AND last_name = 'Tech'
        RETURNING user_id
      `);

      const teamMembers = await client.query(`
        UPDATE website_team_members
        SET name = 'Aesthetician', role = 'Aesthetician', updated_at = NOW()
        WHERE LOWER(BTRIM(name)) = 'nail tech'
          AND LOWER(BTRIM(role)) = 'nail technician'
        RETURNING team_member_id
      `);

      return {
        userCount: users.rowCount,
        seededAccountCount: seededAccount.rowCount,
        teamMemberCount: teamMembers.rowCount,
      };
    });

    console.log(`Consolidated ${result.userCount} staff account(s), normalized ${result.seededAccountCount} seeded account name(s), and updated ${result.teamMemberCount} team listing(s).`);
  } catch (error) {
    console.error('Aesthetician role consolidation failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
