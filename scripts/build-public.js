const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicRoot = path.join(root, 'public');
const browserScripts = [
  'account-edit-toggle.js',
  'account.js',
  'admin-dashboard.js',
  'admin-notifications.js',
  'AdminAppointment.js',
  'AdminContentManagement.js',
  'appointment-booking.js',
  'appointment-modal.js',
  'appointment-summary.js',
  'appointments-staff.js',
  'contact-us.js',
  'faq-chatbot.js',
  'finance-common.js',
  'finance-dashboard.js',
  'finance-expenses.js',
  'finance-reports.js',
  'finance-transactions.js',
  'header.js',
  'homepage-testimonials.js',
  'homepage-treatments-carousel.js',
  'inquiries-admin.js',
  'InventoryManagement.js',
  'InventoryTransactions.js',
  'login.js',
  'my-appointments.js',
  'rating-widget.js',
  'registration.js',
  'public-content.js',
  'reset-password.js',
  'staff-clients.js',
  'staff-dashboard.js',
  'staff-treatment-history.js',
  'treatment-notes.js',
  'tos-privacy-modal.js',
  'Usermanagement.js',
];

fs.rmSync(publicRoot, { recursive: true, force: true });
fs.mkdirSync(publicRoot, { recursive: true });

const publicDocuments = fs.readdirSync(root)
  .filter((name) => ['.html', '.css'].includes(path.extname(name).toLowerCase()));

for (const name of [...publicDocuments, ...browserScripts]) {
  const source = path.join(root, name);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    fs.copyFileSync(source, path.join(publicRoot, name));
  }
}

for (const directory of ['fonts', 'icons', 'images']) {
  const source = path.join(root, directory);
  if (fs.existsSync(source)) {
    fs.cpSync(source, path.join(publicRoot, directory), { recursive: true });
  }
}

console.log('Built allow-listed public assets.');