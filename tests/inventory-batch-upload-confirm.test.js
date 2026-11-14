const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../db');
const inventoryRouter = require('../routes/inventory');

function confirmHandler() {
  return inventoryRouter.stack
    .find((layer) => layer.route?.path === '/batch-upload/confirm' && layer.route.methods.post)
    .route.stack.at(-1).handle;
}

async function invokeConfirm(handler, request) {
  let statusCode = 200;
  let body;
  await handler(request, {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  });
  return { statusCode, body };
}

test('same receipt can be confirmed again while retries with the same request key remain idempotent', async () => {
  const originalTransaction = db.transaction;
  const batches = new Map();
  const products = new Map();
  const purchaseRecords = [];
  let nextBatchId = 1;
  let nextProductId = 1;
  let nextTransactionId = 1;

  db.transaction = async (callback) => callback({
    query: async (sql, values = []) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT purchase_batch_id, request_key, source_hash, payload_hash/.test(sql)) {
        const batch = batches.get(values[0]);
        return { rows: batch ? [batch] : [] };
      }
      if (/INSERT INTO inventory_purchase_batches/.test(sql)) {
        const batch = {
          purchase_batch_id: nextBatchId++,
          request_key: values[0],
          source_hash: values[1],
          payload_hash: values[2],
        };
        batches.set(batch.request_key, batch);
        return { rows: [{ purchase_batch_id: batch.purchase_batch_id }] };
      }
      if (/FROM inventory_purchase_records purchase\s+JOIN inventory_products product/.test(sql)) {
        const batchId = values[0];
        return { rows: purchaseRecords
          .filter(record => record.purchase_batch_id === batchId)
          .map(record => products.get(record.product_id)) };
      }
      if (/SELECT product_id, product_name, category, stock_quantity\s+FROM inventory_products/.test(sql)) {
        const product = products.get([...products.keys()].find(id =>
          products.get(id).product_name.toLowerCase() === values[0].toLowerCase()));
        return { rows: product ? [product] : [] };
      }
      if (/UPDATE inventory_products/.test(sql)) {
        const product = products.get(values[3]);
        product.stock_quantity = values[0];
        product.unit_price = values[1];
        product.expiry_date = values[2] || product.expiry_date;
        return { rows: [{ ...product }] };
      }
      if (/INSERT INTO inventory_products/.test(sql)) {
        const product = {
          product_id: nextProductId++,
          product_name: values[0],
          category: values[1],
          stock_quantity: values[2],
          expiry_date: values[3],
          unit_price: values[4],
        };
        products.set(product.product_id, product);
        return { rows: [{ ...product }] };
      }
      if (/INSERT INTO inventory_transactions/.test(sql)) {
        return { rows: [{ transaction_id: nextTransactionId++ }] };
      }
      if (/INSERT INTO inventory_purchase_records/.test(sql)) {
        purchaseRecords.push({
          purchase_batch_id: values[0],
          product_id: values[3],
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected inventory query: ${sql}`);
    },
  });

  try {
    const handler = confirmHandler();
    const payload = {
      source_hash: 'a'.repeat(64),
      rows: [{
        product_name: 'Test Serum',
        quantity: 12,
        unit_price: 295,
        category: 'Medical/Injection Supplies',
        expiry_date: null,
      }],
    };
    const confirm = (requestKey) => invokeConfirm(handler, {
      body: { ...payload, request_key: requestKey },
      session: { userId: 7 },
    });

    const first = await confirm('11111111-1111-4111-8111-111111111111');
    const retry = await confirm('11111111-1111-4111-8111-111111111111');
    const repeatedReceipt = await confirm('22222222-2222-4222-8222-222222222222');

    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 200);
    assert.equal(repeatedReceipt.statusCode, 201);
    assert.equal(first.body.products.length, 1);
    assert.equal(retry.body.products.length, 1);
    assert.equal(repeatedReceipt.body.products.length, 1);
    assert.equal(batches.size, 2);
    assert.equal(products.get(1).stock_quantity, 24);
  } finally {
    db.transaction = originalTransaction;
  }
});
