(function initializeCsvExport(global) {
  const formulaPrefix = /^[\s\u0000-\u001f\u007f-\u009f\ufeff\u200b]*[=+\-@]/;

  function escapeCell(value) {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && formulaPrefix.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  global.CsvExport = { escapeCell };
}(window));
