const FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f-\u009f\ufeff\u200b]*[=+\-@]/;

function escapeCsvCell(value) {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { escapeCsvCell };
