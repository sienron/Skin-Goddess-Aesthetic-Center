const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');

const draftRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-review-draft' && layer.route.methods.put)
  .route.stack.at(-1).handle;
const reviewRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-review' && layer.route.methods.get)
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

async function loadReview({ products, savedSelection = null }) {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  let statusCode = 200;
  let responseBody;

  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queryCalls.push({ sql, values });
      if (/FROM appointments a/.test(sql)) {
        return {
          rows: [{
            appointment_id: 42,
            service_id: 3,
            status: 'in_progress',
            service: 'Test service',
            client: 'Test client'
          }]
        };
      }
      if (/FROM appointment_inventory_deductions/.test(sql)) return { rows: [] };
      if (/FROM inventory_products product/.test(sql)) return { rows: products };
      if (/SELECT selected_items\s+FROM appointment_inventory_review_drafts/.test(sql)) {
        return savedSelection === null ? { rows: [] } : { rows: [{ selected_items: savedSelection }] };
      }
      return { rows: [] };
    }
  });

  try {
    await reviewRoute({
      params: { id: '42' },
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

test('inventory review preselects enabled service suggestions and leaves other products unselected', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Suggested product', category: 'Treatment', stock_quantity: 5, default_quantity: 2, review_note: 'Provisional', is_suggested: true },
      { product_id: 13, product_name: 'Other product', category: 'Treatment', stock_quantity: 5, default_quantity: null, review_note: null, is_suggested: false },
      { product_id: 14, product_name: 'Unavailable suggestion', category: 'Treatment', stock_quantity: 0, default_quantity: 1, review_note: 'Provisional', is_suggested: true }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    result.responseBody.products.map(({ product_id, is_selected, selected_quantity }) => ({
      product_id, is_selected, selected_quantity
    })),
    [
      { product_id: 12, is_selected: true, selected_quantity: 2 },
      { product_id: 13, is_selected: false, selected_quantity: null },
      { product_id: 14, is_selected: false, selected_quantity: null }
    ]
  );
  const persistedSelection = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.deepEqual(JSON.parse(persistedSelection.values[1]), [
    { productId: 12, quantity: 2, isSuggested: true, suggestionDefaultQuantity: 2 }
  ]);
});

test('inventory review leaves products unselected when a service has no configured suggestions', async () => {
  const result = await loadReview({
    products: [
      { product_id: 13, product_name: 'Manual choice', category: 'Treatment', stock_quantity: 5, default_quantity: null, review_note: null, is_suggested: false }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.products[0].is_selected, false);
  const persistedSelection = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.deepEqual(JSON.parse(persistedSelection.values[1]), []);
});

test('inventory review reloads configured suggestions and preserves saved manual selections', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Configured product', category: 'Treatment', stock_quantity: 5, default_quantity: 2, review_note: 'Provisional', is_suggested: true },
      { product_id: 13, product_name: 'Manual choice', category: 'Treatment', stock_quantity: 5, default_quantity: null, review_note: null, is_suggested: false },
      { product_id: 14, product_name: 'Newly configured product', category: 'Treatment', stock_quantity: 5, default_quantity: 1, review_note: 'Provisional', is_suggested: true }
    ],
    savedSelection: [
      { productId: 12, quantity: 3, isSuggested: true, suggestionDefaultQuantity: 2 },
      { productId: 13, quantity: 2, isSuggested: false }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    result.responseBody.products.filter((product) => product.is_selected).map((product) => [
      product.product_id, product.selected_quantity, product.is_suggested
    ]),
    [
      [12, 3, true],
      [13, 2, false],
      [14, 1, true]
    ]
  );
});

test('inventory review applies a changed suggested quantity while reopening the draft', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Configured product', category: 'Treatment', stock_quantity: 5, default_quantity: 3, review_note: 'Provisional', is_suggested: true }
    ],
    savedSelection: [
      { productId: 12, quantity: 2, isSuggested: true, suggestionDefaultQuantity: 2 }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.products[0].selected_quantity, 3);
  const persistedSelection = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.deepEqual(JSON.parse(persistedSelection.values[1]), [
    { productId: 12, quantity: 3, isSuggested: true, suggestionDefaultQuantity: 3 }
  ]);
});

test('inventory review draft accepts a valid quantity up to current stock', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 5, isSuggested: true, suggestionDefaultQuantity: 2 }],
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
  assert.deepEqual(JSON.parse(draftUpsert.values[1]), [
    { productId: 12, quantity: 5, isSuggested: true, suggestionDefaultQuantity: 2 }
  ]);
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
