const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');
const servicesRouter = require('../routes/services');
const { buildCandidates } = require('../migrations/039-appointment-inventory-mappings');
const { migrate: enableSuggestions } = require('../migrations/040-enable-service-inventory-suggestions');

const draftRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-review-draft' && layer.route.methods.put)
  .route.stack.at(-1).handle;
const reviewRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-review' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const serviceDefaultsRoute = servicesRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/inventory-defaults' && layer.route.methods.put)
  .route.stack.at(-1).handle;
const completeRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/complete-with-inventory' && layer.route.methods.post)
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

async function saveServiceDefaults({ products }) {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  let statusCode = 200;
  let responseBody;

  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queryCalls.push({ sql, values });
      if (/SELECT service_id FROM services/.test(sql)) {
        return { rows: [{ service_id: 31 }] };
      }
      if (/SELECT product_id\s+FROM inventory_products/.test(sql)) {
        return { rows: values[0].map((productId) => ({ product_id: productId })) };
      }
      if (/SELECT mapping\.product_id, product\.product_name/.test(sql)) {
        return {
          rows: products.map((item) => ({
            product_id: item.productId,
            product_name: `Product ${item.productId}`,
            category: 'Medical/Injection Supplies',
            default_quantity: item.defaultQuantity,
            is_enabled: item.isEnabled,
            review_note: item.reviewNote
          }))
        };
      }
      return { rows: [] };
    }
  });

  try {
    await serviceDefaultsRoute({
      params: { id: '31' },
      body: {
        products: products.map((item) => ({
          productId: item.productId,
          defaultQuantity: item.defaultQuantity,
          isEnabled: item.isEnabled,
          reviewNote: item.reviewNote
        }))
      },
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

async function completeAppointment({
  selectedItems,
  stockByProductId = new Map([[12, 20]]),
  alreadyDeducted = false,
  failOnInventoryLog = false,
  failOnConditionalUpdate = false
}) {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  let transactionStarted = false;
  let committed = false;
  let rolledBack = false;
  let statusCode = 200;
  let responseBody;

  db.transaction = async (callback) => {
    transactionStarted = true;
    try {
      const result = await callback({
        async query(sql, values = []) {
          queryCalls.push({ sql, values });
          if (/SELECT appointment_id, appointment_status, user_id/.test(sql)) {
            return { rows: [{ appointment_id: 42, appointment_status: 'in_progress', user_id: null }] };
          }
          if (/SELECT selected_items, reviewed_by, reviewed_at/.test(sql)) {
            return {
              rows: [{
                selected_items: selectedItems,
                reviewed_by: 7,
                reviewed_at: '2026-10-16T00:00:00Z'
              }]
            };
          }
          if (/FROM appointment_inventory_deductions/.test(sql)) {
            return { rows: alreadyDeducted ? [{ confirmed_at: '2026-10-16T00:00:00Z' }] : [] };
          }
          if (/SELECT product_id, product_name, stock_quantity\s+FROM inventory_products/.test(sql)) {
            return {
              rows: values[0]
                .filter((productId) => stockByProductId.has(productId))
                .map((productId) => ({
                  product_id: productId,
                  product_name: `Product ${productId}`,
                  stock_quantity: stockByProductId.get(productId)
                }))
            };
          }
          if (/UPDATE inventory_products/.test(sql)) {
            if (failOnConditionalUpdate) return { rows: [] };
            const [quantity, productId] = values;
            return {
              rows: [{
                product_id: productId,
                product_name: `Product ${productId}`,
                category: 'Treatment',
                stock_quantity: stockByProductId.get(productId) - quantity
              }]
            };
          }
          if (/INSERT INTO inventory_transactions/.test(sql) && failOnInventoryLog) {
            throw new Error('Simulated inventory transaction failure.');
          }
          if (/UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql)) {
            return { rows: [{ appointment_id: 42, user_id: null }] };
          }
          return { rows: [] };
        }
      });
      committed = true;
      return result;
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  };

  try {
    await completeRoute({
      params: { id: '42' },
      body: { selectedItems },
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

  return { statusCode, responseBody, queryCalls, transactionStarted, committed, rolledBack };
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
      { product_id: 14, is_selected: true, selected_quantity: 1 }
    ]
  );
  const persistedSelection = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.deepEqual(JSON.parse(persistedSelection.values[1]), [
    { productId: 12, quantity: 2, isSuggested: true, suggestionDefaultQuantity: 2 },
    { productId: 14, quantity: 1, isSuggested: true, suggestionDefaultQuantity: 1 }
  ]);
  const mappingQuery = result.queryCalls.find(({ sql }) => /FROM inventory_products product/.test(sql));
  assert.match(mappingQuery.sql, /mapping\.is_enabled = TRUE/);
  assert.deepEqual(mappingQuery.values, [3]);
});

test('provisional catalog candidates use exact supplied products and do not assume quantities', () => {
  const candidates = buildCandidates();
  const antiAgingDrip = candidates
    .filter((candidate) => candidate.service_name === 'Anti-Aging Drip')
    .map((candidate) => candidate.product_name)
    .sort();

  assert.equal(candidates.length, 321);
  assert.deepEqual(antiAgingDrip, [
    '10cc Syringe',
    '3cc Syringe',
    'Cannula',
    'Macroset (IV Set)',
    'Scalp Vein Set',
    'Sterile Water'
  ]);
  assert.ok(candidates.every((candidate) => !Object.hasOwn(candidate, 'default_quantity')));
  assert.equal(candidates.some((candidate) => candidate.service_name === '3-in-1 Facial Oxy'), false);
  const keys = candidates.map(({ service_name, category, product_name }) => (
    `${service_name}\u0000${category}\u0000${product_name}`
  ));
  assert.equal(new Set(keys).size, keys.length);
});

test('Anti-Aging Drip preselects all six configured product suggestions', async () => {
  const suggestedNames = [
    'Macroset (IV Set)',
    '10cc Syringe',
    '3cc Syringe',
    'Cannula',
    'Scalp Vein Set',
    'Sterile Water'
  ];
  const result = await loadReview({
    products: suggestedNames.map((product_name, index) => ({
      product_id: index + 1,
      product_name,
      category: 'Medical/Injection Supplies',
      stock_quantity: 5,
      default_quantity: null,
      review_note: 'Confirm actual use and quantity.',
      is_suggested: true
    }))
  });

  assert.equal(result.responseBody.products.length, 6);
  assert.ok(result.responseBody.products.every((product) => product.is_selected));
  assert.ok(result.responseBody.products.every((product) => product.selected_quantity === null));
});

test('inventory review keeps out-of-stock and insufficient-stock draft selections and quantities', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Out of stock suggestion', category: 'Treatment', stock_quantity: 0, default_quantity: 2, review_note: 'Provisional', is_suggested: true },
      { product_id: 13, product_name: 'Insufficient stock manual selection', category: 'Treatment', stock_quantity: 1, default_quantity: null, review_note: null, is_suggested: false }
    ],
    savedSelection: [
      { productId: 12, quantity: 3, isSuggested: true, suggestionDefaultQuantity: 2 },
      { productId: 13, quantity: 4, isSuggested: false }
    ]
  });

  assert.deepEqual(
    result.responseBody.products.map(({ product_id, is_selected, selected_quantity }) => [
      product_id, is_selected, selected_quantity
    ]),
    [[12, true, 3], [13, true, 4]]
  );
  assert.equal(result.responseBody.removedMissingSelection, false);
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

test('inventory review preselects enabled suggestions without inventing a quantity', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Unconfirmed quantity', category: 'Treatment', stock_quantity: 5, default_quantity: null, review_note: 'Confirm use', is_suggested: true }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.products[0].is_selected, true);
  assert.equal(result.responseBody.products[0].selected_quantity, null);
  const persistedSelection = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_review_drafts/.test(sql));
  assert.deepEqual(JSON.parse(persistedSelection.values[1]), [
    { productId: 12, quantity: null, isSuggested: true, suggestionDefaultQuantity: null }
  ]);
});

test('inventory review reloads configured suggestions and preserves saved manual selections', async () => {
  const result = await loadReview({
    products: [
      { product_id: 12, product_name: 'Configured product', category: 'Treatment', stock_quantity: 5, default_quantity: 2, review_note: 'Provisional', is_suggested: true },
      { product_id: 13, product_name: 'Manual choice', category: 'Treatment', stock_quantity: 5, default_quantity: null, review_note: null, is_suggested: false },
      { product_id: 14, product_name: 'Newly configured product', category: 'Treatment', stock_quantity: 5, default_quantity: 1, review_note: 'Provisional', is_suggested: true },
      { product_id: 15, product_name: 'New suggestion with saved manual quantity', category: 'Treatment', stock_quantity: 5, default_quantity: 4, review_note: 'Provisional', is_suggested: true }
    ],
    savedSelection: [
      { productId: 12, quantity: 3, isSuggested: true, suggestionDefaultQuantity: 2 },
      { productId: 13, quantity: 2, isSuggested: false },
      { productId: 15, quantity: 3, isSuggested: false }
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
      [14, 1, true],
      [15, 3, true]
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

test('inventory review draft preserves a quantity greater than current stock for administrator review', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 6, isSuggested: false }],
    stockByProductId: new Map([[12, 5]])
  });

  assert.equal(result.statusCode, 200);
});

test('inventory review draft preserves an out-of-stock selected product', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    stockByProductId: new Map([[12, 0]])
  });

  assert.equal(result.statusCode, 200);
});

test('inventory review draft rejects non-positive quantities', async () => {
  const result = await saveDraft({
    selectedItems: [{ productId: 12, quantity: 0, isSuggested: false }],
    stockByProductId: new Map([[12, 5]])
  });

  assert.equal(result.statusCode, 400);
  assert.match(result.responseBody.message, /positive whole number/);
});

test('service defaults allow an enabled suggestion with no unconfirmed default quantity', async () => {
  const result = await saveServiceDefaults({
    products: [{
      productId: 11,
      defaultQuantity: null,
      isEnabled: true,
      reviewNote: 'Confirm actual use and quantity with clinic.'
    }]
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.responseBody, [{
    product_id: 11,
    product_name: 'Product 11',
    category: 'Medical/Injection Supplies',
    default_quantity: null,
    is_enabled: true,
    review_note: 'Confirm actual use and quantity with clinic.'
  }]);
  const upsert = result.queryCalls.find(({ sql }) => /INSERT INTO service_inventory_product_defaults/.test(sql));
  assert.equal(upsert.values[2], null);
  assert.equal(upsert.values[3], true);
});

test('completion rejects invalid quantities before opening a transaction', async () => {
  for (const quantity of [0, -1, null, '', '2.5', 'invalid']) {
    const result = await completeAppointment({
      selectedItems: [{ productId: 12, quantity, isSuggested: false }]
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.transactionStarted, false);
  }
});

test('completion rechecks stock and rolls back when stock is insufficient', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 3, isSuggested: false }],
    stockByProductId: new Map([[12, 2]])
  });

  assert.equal(result.statusCode, 409);
  assert.match(result.responseBody.message, /Product 12 has only 2 units available/);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql)), false);
});

test('completion identifies all selected products with insufficient or zero stock', async () => {
  const result = await completeAppointment({
    selectedItems: [
      { productId: 12, quantity: 3, isSuggested: true },
      { productId: 13, quantity: 1, isSuggested: true }
    ],
    stockByProductId: new Map([[12, 2], [13, 0]])
  });

  assert.equal(result.statusCode, 409);
  assert.match(result.responseBody.message, /Product 12 has only 2 units available/);
  assert.match(result.responseBody.message, /Product 13 is out of stock \(0 units available\)/);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql)), false);
});

test('completion rejects products that are no longer in inventory', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    stockByProductId: new Map()
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
});

test('completion prevents a duplicate inventory deduction', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    alreadyDeducted: true
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
});

test('completion rolls back if stock changes before the guarded inventory update', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    failOnConditionalUpdate: true
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql)), false);
});

test('completion rolls back a stock update if transaction logging fails', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 1, isSuggested: false }],
    failOnInventoryLog: true
  });

  assert.equal(result.statusCode, 500);
  assert.equal(result.rolledBack, true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE inventory_products/.test(sql)), true);
  assert.equal(result.queryCalls.some(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql)), false);
});

test('completion logs the appointment deduction and updates status in one successful transaction', async () => {
  const result = await completeAppointment({
    selectedItems: [{ productId: 12, quantity: 2, isSuggested: false }]
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.committed, true);
  assert.equal(result.rolledBack, false);
  assert.equal(result.responseBody.status, 'completed');
  const deductionLog = result.queryCalls.find(({ sql }) => /INSERT INTO inventory_transactions/.test(sql));
  assert.equal(deductionLog.values[6], 7);
  assert.equal(deductionLog.values[7], 42);
  const deductionRecord = result.queryCalls.find(({ sql }) => /INSERT INTO appointment_inventory_deductions/.test(sql));
  const statusUpdate = result.queryCalls.find(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'completed'/.test(sql));
  assert.ok(deductionRecord);
  assert.ok(statusUpdate);
  assert.ok(result.queryCalls.indexOf(deductionLog) < result.queryCalls.indexOf(statusUpdate));
});

test('suggestion migration enables all candidates without assigning or overwriting quantities', async () => {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queryCalls.push({ sql, values });
      if (/to_regclass/.test(sql)) return { rows: [{ mapping_table: 'service_inventory_product_defaults' }] };
      if (/INSERT INTO service_inventory_product_defaults/.test(sql)) {
        return { rowCount: 321, rows: [] };
      }
      return { rows: [] };
    }
  });

  try {
    const result = await enableSuggestions();
    assert.deepEqual(result, { candidateCount: 321, enabledCount: 321 });
  } finally {
    db.transaction = originalTransaction;
  }

  const upsert = queryCalls.find(({ sql }) => /INSERT INTO service_inventory_product_defaults/.test(sql));
  assert.match(upsert.sql, /DO UPDATE SET is_enabled = TRUE, updated_at = NOW\(\)/);
  assert.doesNotMatch(upsert.sql, /DO UPDATE SET[^;]*default_quantity/s);
  const candidates = JSON.parse(upsert.values[0]);
  assert.equal(candidates.length, 321);
  assert.equal(candidates.filter(({ service_name }) => service_name === 'Anti-Aging Drip').length, 6);
});
