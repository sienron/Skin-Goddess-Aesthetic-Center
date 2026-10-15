const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');

const draftRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-review-draft' && layer.route.methods.put)
  .route.stack.at(-1).handle;

async function saveDraft({ selectedItems, stockByProductId }) {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  let statusCode = 200;
  let responseBody;

  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queryCalls.push({ sql, values });
      if (/SELECT appointment_status\s+FROM appointments/.test(sql)) {
        return { rows: [{ appointment_status: 'in_progress' }] };
      }
      if (/FROM inventory_products/.test(sql)) {
        const productIds = values[0];
        return {
          rows: productIds
            .filter((productId) => stockByProductId.has(productId))
            .map((productId) => ({
              product_id: productId,
              product_name: `Product ${productId}`,
              stock_quantity: stockByProductId.get(productId)
            }))
        };
      }
      return { rows: [] };
    }
  });

  try {
    await draftRoute({
      params: { id: '42' },
      body: { selectedItems, reviewed: false },
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

  return { statusCode, responseBody, queryCalls };
}

test('inventory review draft accepts a valid quantity up to current stock', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 5, isSuggested: false }],
    stockByProductId: new Map([[12, 5]])
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.message, 'Product review draft saved.');
  const stockQuery = result.queryCalls.find(({ sql }) => /FROM inventory_products/.test(sql));
  assert.deepEqual(stockQuery.values[0], [12]);
  assert.match(stockQuery.sql, /stock_quantity/);
  const draftUpsert = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.match(draftUpsert.sql, /\$3::integer/);
  assert.match(draftUpsert.sql, /\$4::boolean/);
});

test('inventory review draft rejects a quantity greater than current stock', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 6, isSuggested: false }],
    stockByProductId: new Map([[12, 5]])
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.responseBody.message, 'Product 12 has only 5 units available.');
});

test('inventory review draft rejects zero-stock products', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    stockByProductId: new Map([[12, 0]])
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.responseBody.message, 'Product 12 is out of stock and cannot be selected.');
});

test('inventory review draft rejects non-positive quantities', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 0, isSuggested: false }],
    stockByProductId: new Map([[12, 5]])
  });

  assert.equal(result.statusCode, 400);
  assert.match(result.responseBody.message, /positive whole number/);
});
