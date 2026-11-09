const INVENTORY_CATEGORIES = Object.freeze([
  'Medical/Injection Supplies',
  'Disposables & Clinic Consumables',
  'Facial/Treatment Prep Products',
  'Facial Treatment Products (Professional Use)',
  'Skincare Products (Retail / Aftercare)',
  'Soaps & Cleansers',
  'Tools/Equipment/Misc.'
]);

function isInventoryCategory(category) {
  return typeof category === 'string' && INVENTORY_CATEGORIES.includes(category);
}

module.exports = { INVENTORY_CATEGORIES, isInventoryCategory };
