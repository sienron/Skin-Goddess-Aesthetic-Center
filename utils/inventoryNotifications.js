const { notifyRoles } = require('./notifications');
const { LOW_STOCK_THRESHOLD, CRITICAL_STOCK_THRESHOLD } = require('./inventoryThresholds');

async function notifyStockTransition(previousStock, currentStock, productName) {
  let type;
  let severity;
  if (previousStock > CRITICAL_STOCK_THRESHOLD && currentStock <= CRITICAL_STOCK_THRESHOLD) {
    type = 'inventory_critical_stock';
    severity = 'critical';
  } else if (previousStock > LOW_STOCK_THRESHOLD && currentStock <= LOW_STOCK_THRESHOLD) {
    type = 'inventory_low_stock';
    severity = 'low';
  }

  if (type) {
    await notifyRoles(
      ['inventory_officer', 'admin'],
      type,
      `${severity === 'critical' ? 'URGENT: ' : ''}${productName} stock dropped to ${currentStock} units (${severity} stock alert).`,
    );
  }
}

module.exports = { notifyStockTransition };
