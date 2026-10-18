const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const inventoryNotifications = require('../utils/inventoryNotifications');

const originalNotify = inventoryNotifications.notifyStockTransition;
inventoryNotifications.notifyStockTransition = async () => {};
const inventoryRouter = require('../routes/inventory');
const stockRoute = inventoryRouter.stack
  .find((layer) => layer.route?.path === '/:id/stock' && layer.route.methods.put)
  .route.stack.at(-1).handle;

async function adjustStock(stockAdjustment, startingStock = 5) {
  const originalTransaction = db.transaction;
  const queries = [];
  let statusCode = 200;
  let responseBody;
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT stock_quantity\s+FROM inventory_products/.test(sql)) {
        return { rows: [{ stock_quantity: startingStock }] };
      }
      if (/UPDATE inventory_products/.test(sql)) {
        return {
          rows: [{
            product_id: 12,
            product_name: 'Test product',
            category: 'Supplies',
            stock_quantity: startingStock + values[0],
            expiry_date: null
          }]
        };
      }
      return { rows: [] };
    }
  });

  try {
    await stockRoute({
      params: { id: '12' },
      body: { stock_adjustment: stockAdjustment },
      session: { userId: 7 }
    }, {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      }
    });
  } finally {
    db.transaction = originalTransaction;
  }

  return { statusCode, responseBody, queries };
}

test('manual stock adjustments apply a relative database update and log a manual adjustment', async () => {
  const result = await adjustStock(-2, 5);
  const update = result.queries.find(({ sql }) => /UPDATE inventory_products/.test(sql));
  const transaction = result.queries.find(({ sql }) => /INSERT INTO inventory_transactions/.test(sql));

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.stock_quantity, 3);
  assert.match(update.sql, /stock_quantity = stock_quantity \+ \$1/);
  assert.deepEqual(update.values, [-2, 12]);
  assert.match(update.sql, /stock_quantity \+ \$1 >= 0/);
  assert.equal(transaction.values[2], 'Adjustment');
  assert.deepEqual(transaction.values.slice(3, 6), [2, 5, 3]);
});

test('manual stock adjustments reject a negative resulting quantity before updating', async () => {
  const result = await adjustStock(-6, 5);
  assert.equal(result.statusCode, 409);
  assert.match(result.responseBody.message, /cannot be reduced below zero/);
  assert.equal(result.queries.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
});

test.after(() => {
  inventoryNotifications.notifyStockTransition = originalNotify;
});
