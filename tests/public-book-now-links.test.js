const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public page Book Now links use the same booking destination on desktop and mobile', () => {
  for (const file of ['index.html', 'ContactUsPage.html', 'AboutUsPage.html', 'ServicesPage.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, /<a class="book-now-btn" href="\/UserAppointment\.html">BOOK NOW<\/a>/);
    assert.match(html, /<a class="book-now-btn mobile-nav-book-btn" href="\/UserAppointment\.html">BOOK NOW<\/a>/);
  }
});
