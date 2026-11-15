const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const financeRouter = require('../routes/finance');

test('Sales & Transactions loads the client selection and payment-history handlers', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'FinancesTransactions.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'finance-transactions.js'), 'utf8');

  assert.match(page, /finance-transactions\.js\?v=20261115-5/);
  assert.match(page, /id="exportReceiptXlsx"/);
  assert.match(client, /byId\('exportReceiptXlsx'\)\.href = `\$\{receiptUrl\}\?format=xlsx`/);
  assert.match(page, /id="saleClient"/);
  assert.match(page, /id="clientPaymentHistoryModal"/);
  assert.match(page, /<option value="outstanding">Outstanding<\/option>/);
  assert.match(page, /id="receivableStatus"/);
  assert.match(client, /common\.fetchJson\('\/api\/finance\/clients'\)/);
  assert.match(client, /\/api\/finance\/clients\/\$\{encodeURIComponent\(state\.selectedClient\.id\)\}\/payment-history/);
  assert.match(client, /historyButton\.addEventListener\('click', \(\) => showClientPaymentHistory\(\)\)/);
});

test('outstanding payment-ledger filter returns service balances as actionable rows', async () => {
  const originalQuery = db.query;
  db.query = async (sql) => {
    assert.match(sql, /a\.booked_service_price > COALESCE\(paid\.amount, 0\)/);
    return { rows: [{
      appointment_id: 42,
      customer_id: 19,
      appointment_date: '2026-10-12',
      client: 'Client One',
      service: 'Facial',
      service_price: 400,
      amount_paid: 150,
      outstanding: 250,
      status: 'Partially paid',
    }] };
  };

  try {
    const result = await invoke(routeHandler('/transactions', 'get'), {
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'outstanding',
        sort: 'date',
        direction: 'desc',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.rows[0].status, 'outstanding');
    assert.equal(result.body.rows[0].amount, 250);
    assert.equal(result.body.rows[0].payment_type, 'service');
    assert.equal(result.body.rows[0].customer_id, 19);
  } finally {
    db.query = originalQuery;
  }
});

test('receivables can be filtered to unpaid services', async () => {
  const originalQuery = db.query;
  let sql = '';
  db.query = async (query) => {
    sql = query;
    return { rows: [] };
  };

  try {
    const result = await invoke(routeHandler('/receivables', 'get'), {
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'unpaid',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.match(sql, /COALESCE\(paid\.amount, 0\) <= 0/);
  } finally {
    db.query = originalQuery;
  }
});

function routeHandler(path, method) {
  return financeRouter.stack
    .find((layer) => layer.route?.path === path && layer.route.methods[method])
    .route.stack.at(-1).handle;
}

async function invoke(handler, request) {
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

test('payment ledger validates sorting and applies header filters before pagination', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return /COUNT\(\*\)/.test(sql)
      ? { rows: [{ count: 1 }] }
      : { rows: [{ payment_id: 3, amount: 25 }] };
  };

  try {
    const result = await invoke(routeHandler('/transactions', 'get'), {
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        type: 'balance',
        method: 'cash',
        status: 'posted',
        q: 'Client',
        sort: 'amount',
        direction: 'asc',
        page: '2',
        limit: '10',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, 1);
    assert.match(calls[1].sql, /ORDER BY p\.amount ASC, p\.payment_id ASC LIMIT/);
    assert.match(calls[0].sql, /p\.payment_type = \$3/);
    assert.match(calls[0].sql, /p\.method = \$4/);
    assert.match(calls[0].sql, /p\.status = \$5/);
    assert.match(calls[0].sql, /ILIKE \$6/);
    assert.match(calls[1].sql, /COALESCE\(a\.user_id, p\.customer_id\) AS customer_id/);
    assert.deepEqual(calls[1].values.slice(-2), [10, 10]);
  } finally {
    db.query = originalQuery;
  }
});

test('payment ledger rejects unsupported sort columns', async () => {
  const result = await invoke(routeHandler('/transactions', 'get'), {
    query: { from: '2026-10-01', to: '2026-10-31', sort: 'payment_id; DROP TABLE payments' },
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /sort column/);
});

test('receivables include active appointment statuses and only eligible posted payments', async () => {
  const originalQuery = db.query;
  let call;
  db.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [{
      appointment_id: 42,
      appointment_status: 'confirmed',
      client: 'Client One',
      service: 'Facial',
      service_price: 400,
      amount_paid: 300,
      outstanding: 100,
      status: 'Partially paid',
    }] };
  };

  try {
    const result = await invoke(routeHandler('/receivables', 'get'), {
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        q: 'Client One',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body[0].appointment_id, 42);
    assert.equal(result.body[0].appointment_status, 'confirmed');
    assert.equal(result.body[0].amount_paid, 300);
    assert.equal(result.body[0].outstanding, 100);
    assert.equal(result.body[0].status, 'Partially paid');
    assert.match(call.sql, /a\.appointment_date BETWEEN \$2::date AND \$3::date/);
    assert.match(call.sql, /ILIKE \$4/);
    assert.match(call.sql, /a\.appointment_status <> 'cancelled'/);
    assert.match(call.sql, /a\.payment_status <> 'not_recorded'/);
    assert.doesNotMatch(call.sql, /a\.appointment_status = 'completed'/);
    assert.match(call.sql, /WHERE status = 'posted'/);
    assert.match(call.sql, /payment_type IN \('reservation', 'balance'\)/);
    assert.match(call.sql, /a\.booked_service_price > COALESCE\(paid\.amount, 0\)/);
    assert.deepEqual(call.values.slice(1), ['2026-10-01', '2026-10-31', '%Client One%']);
  } finally {
    db.query = originalQuery;
  }
});

test('balance payments are accepted before completion and remain capped at the booked balance', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/SELECT booked_service_price, is_demo/.test(sql)) {
        return { rows: [{ booked_service_price: 400, is_demo: false }] };
      }
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/WHERE request_key = \$1/.test(sql)) return { rows: [] };
      if (/SELECT COALESCE\(SUM\(amount\), 0\) AS paid/.test(sql)) {
        return { rows: [{ paid: 300 }] };
      }
      if (/INSERT INTO payments/.test(sql)) {
        return { rows: [{ payment_id: 90, appointment_id: 42, payment_type: 'balance', amount: 100 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  try {
    const result = await invoke(routeHandler('/payments', 'post'), {
      body: {
        appointment_id: 42,
        payment_type: 'balance',
        amount: 100,
        method: 'gcash',
        request_key: '123e4567-e89b-42d3-a456-426614174001',
      },
      session: { userId: 7 },
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.amount, 100);
    const appointmentLock = calls.find((call) => /SELECT booked_service_price, is_demo/.test(call.sql));
    assert.match(appointmentLock.sql, /appointment_status <> 'cancelled'/);
    assert.match(appointmentLock.sql, /is_demo = FALSE/);
    assert.match(appointmentLock.sql, /FOR UPDATE/);
    const paidQuery = calls.find((call) => /SELECT COALESCE\(SUM\(amount\), 0\) AS paid/.test(call.sql));
    assert.match(paidQuery.sql, /status = 'posted'/);
    assert.match(paidQuery.sql, /payment_type IN \('reservation', 'balance'\)/);
    assert.match(calls.find((call) => /INSERT INTO payments/.test(call.sql)).sql, /request_key/);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('balance payments cannot exceed the remaining amount or target cancelled appointments', async () => {
  const originalTransaction = db.transaction;
  let insertCount = 0;
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/WHERE request_key = \$1/.test(sql)) return { rows: [] };
      if (/SELECT booked_service_price, is_demo/.test(sql)) {
        return { rows: [{ booked_service_price: 400, is_demo: false }] };
      }
      if (/SELECT COALESCE\(SUM\(amount\), 0\) AS paid/.test(sql)) {
        return { rows: [{ paid: 300 }] };
      }
      if (/INSERT INTO payments/.test(sql)) {
        insertCount += 1;
        return { rows: [{ payment_id: 90, amount: 101 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  try {
    const overpayment = await invoke(routeHandler('/payments', 'post'), {
      body: { appointment_id: 42, payment_type: 'balance', amount: 101, method: 'gcash', request_key: '123e4567-e89b-42d3-a456-426614174002' },
      session: { userId: 7 },
    });
    assert.equal(overpayment.statusCode, 400);
    assert.match(overpayment.body.message, /exceeds the outstanding balance/);
    assert.equal(insertCount, 0);

    db.transaction = async (callback) => callback({
      query: async (sql) => {
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
        if (/WHERE request_key = \$1/.test(sql)) return { rows: [] };
        if (/SELECT booked_service_price, is_demo/.test(sql)) return { rows: [] };
        throw new Error(`Unexpected query after cancelled appointment lookup: ${sql}`);
      },
    });
    const cancelled = await invoke(routeHandler('/payments', 'post'), {
      body: { appointment_id: 42, payment_type: 'balance', amount: 100, method: 'gcash', request_key: '123e4567-e89b-42d3-a456-426614174003' },
      session: { userId: 7 },
    });

    assert.equal(cancelled.statusCode, 404);
    assert.match(cancelled.body.message, /Active appointment not found/);
    assert.equal(insertCount, 0);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('balance payment retries are idempotent and reject reused keys with changed details', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/WHERE request_key = \$1/.test(sql)) {
        return { rows: [{
          payment_id: 90,
          appointment_id: 42,
          payment_type: 'balance',
          amount: 100,
          method: 'gcash',
          reference_no: null,
          note: null,
          recorded_by: 7,
          status: 'posted',
        }] };
      }
      throw new Error(`Unexpected query for idempotent retry: ${sql}`);
    },
  });

  try {
    const request = {
      body: {
        appointment_id: 42,
        payment_type: 'balance',
        amount: 100,
        method: 'gcash',
        request_key: '123e4567-e89b-42d3-a456-426614174004',
      },
      session: { userId: 7 },
    };
    const retry = await invoke(routeHandler('/payments', 'post'), request);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.payment_id, 90);

    const mismatch = await invoke(routeHandler('/payments', 'post'), {
      ...request,
      body: { ...request.body, amount: 99 },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.match(mismatch.body.message, /already used for different payment details/);
    assert.equal(calls.some((call) => /INSERT INTO payments/.test(call.sql)), false);
    assert.equal(calls.some((call) => /FROM appointments/.test(call.sql)), false);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('sale product options include real inventory records with zero stock', async () => {
  const originalQuery = db.query;
  let sql;
  db.query = async (query) => {
    sql = query;
    return { rows: [
      { product_id: 4, product_name: 'Serum', stock_quantity: 8 },
      { product_id: 5, product_name: 'Cleanser', stock_quantity: 0 },
    ] };
  };

  try {
    const result = await invoke(routeHandler('/sale-products', 'get'), { query: {} });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.map((product) => product.stock_quantity), [8, 0]);
    assert.doesNotMatch(sql, /WHERE\s+stock_quantity\s*>\s*0/i);
  } finally {
    db.query = originalQuery;
  }
});

test('sale client options return active clients with the dropdown fields', async () => {
  const originalQuery = db.query;
  let call;
  db.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [{ user_id: 19, name: 'Client One', email: 'client@example.test' }] };
  };

  try {
    const result = await invoke(routeHandler('/clients', 'get'), { query: {} });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, [{ user_id: 19, name: 'Client One', email: 'client@example.test' }]);
    assert.match(call.sql, /role = 'client' AND status = 'active'/);
    assert.equal(call.values, undefined);
  } finally {
    db.query = originalQuery;
  }
});

test('payment and appointment details expose the associated client ID', async () => {
  const originalQuery = db.query;
  db.query = async (sql) => {
    if (/FROM payments p/.test(sql)) {
      return { rows: [{
        payment_id: 7,
        appointment_id: null,
        customer_id: 19,
        client: 'Client One',
        amount: 25,
      }] };
    }
    if (/FROM appointments a/.test(sql)) {
      return { rows: [{
        appointment_id: 42,
        customer_id: 19,
        client: 'Client One',
        service_price: 150,
      }] };
    }
    return { rows: [] };
  };

  try {
    const payment = await invoke(routeHandler('/payments/:id', 'get'), {
      params: { id: '7' },
      query: {},
    });
    assert.equal(payment.statusCode, 200);
    assert.equal(payment.body.payment.customer_id, 19);

    const appointment = await invoke(routeHandler('/appointments/:id', 'get'), {
      params: { id: '42' },
      query: {},
    });
    assert.equal(appointment.statusCode, 200);
    assert.equal(appointment.body.payment.customer_id, 19);
  } finally {
    db.query = originalQuery;
  }
});

test('expense records apply the category filter and server-side sort before pagination', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return /COUNT\(\*\)/.test(sql)
      ? { rows: [{ count: 1 }] }
      : { rows: [{
        expense_id: 8,
        amount: 25,
        recorded_by: 7,
        recorded_by_name: 'Admin User',
        recorded_by_role: 'admin',
      }] };
  };

  try {
    const result = await invoke(routeHandler('/expenses', 'get'), {
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        category: 'Utilities',
        q: 'water',
        sort: 'amount',
        direction: 'desc',
        page: '1',
        limit: '25',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.rows[0].recorded_by_name, 'Admin User');
    assert.equal(result.body.rows[0].recorded_by_role, 'admin');
    assert.match(calls[0].sql, /category = \$3/);
    assert.match(calls[0].sql, /description ILIKE \$4/);
    assert.match(calls[1].sql, /expense\.recorded_by/);
    assert.match(calls[1].sql, /LEFT JOIN users recorder ON recorder\.user_id = expense\.recorded_by/);
    assert.match(calls[1].sql, /ORDER BY expense\.amount DESC,\s*expense\.expense_id DESC\s+LIMIT/);
  } finally {
    db.query = originalQuery;
  }
});

test('pending inventory purchases include the recorded user and calculated cost', async () => {
  const originalQuery = db.query;
  let sql;
  db.query = async (query) => {
    sql = query;
    return { rows: [{
      purchase_id: 11,
      product_name: 'Serum',
      quantity: 3,
      unit_price: 12.5,
      total_cost: 37.5,
      recorded_by: 'Inventory Officer',
    }] };
  };

  try {
    const result = await invoke(routeHandler('/inventory-purchase-suggestions', 'get'), { query: {} });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body[0].total_cost, 37.5);
    assert.equal(result.body[0].recorded_by, 'Inventory Officer');
    assert.match(sql, /purchase\.review_status = 'pending'/);
    assert.match(sql, /purchase\.quantity \* purchase\.unit_price/);
    assert.match(sql, /inventory_tx\.created_by/);
  } finally {
    db.query = originalQuery;
  }
});

test('purchase review details include batch invoice trace and rejection audit data', async () => {
  const originalQuery = db.query;
  let sql;
  db.query = async (query, values) => {
    sql = query;
    assert.deepEqual(values, [11]);
    return { rows: [{
      purchase_id: 11,
      purchase_batch_id: 5,
      product_name: 'Serum',
      quantity: 3,
      unit_price: 12.5,
      total_cost: 37.5,
      invoice_source_hash: 'a'.repeat(64),
      review_status: 'rejected',
      rejection_reason: 'Duplicate invoice row',
    }] };
  };

  try {
    const result = await invoke(routeHandler('/inventory-purchase-suggestions/:id', 'get'), {
      params: { id: '11' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.purchase_batch_id, 5);
    assert.equal(result.body.invoice_source_hash, 'a'.repeat(64));
    assert.equal(result.body.rejection_reason, 'Duplicate invoice row');
    assert.match(sql, /purchase\.rejected_by/);
    assert.match(sql, /batch\.source_hash/);
  } finally {
    db.query = originalQuery;
  }
});

test('purchase approval creates one linked expense from the confirmed purchase values', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/FOR UPDATE/.test(sql)) {
        return { rows: [{
          purchase_id: 11,
          product_name: 'Serum',
          quantity: 3,
          unit_price: '12.50',
          total_cost: '37.50',
          purchase_date: '2026-11-14',
          expense_id: null,
          review_status: 'pending',
        }] };
      }
      if (/pg_advisory_xact_lock/.test(sql) || /cash_closings/.test(sql)) return { rows: [] };
      if (/INSERT INTO expenses/.test(sql)) {
        return { rows: [{
          expense_id: 91,
          expense_date: '2026-11-14',
          category: 'Inventory & Supplies',
          amount: 37.5,
          reference_no: 'INV-PURCHASE-11',
        }] };
      }
      if (/UPDATE inventory_purchase_records/.test(sql)) {
        return { rows: [{ purchase_id: 11, review_status: 'approved' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  try {
    const result = await invoke(routeHandler('/inventory-purchase-suggestions/:id/approve', 'post'), {
      params: { id: '11' },
      session: { userId: 7 },
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.expense.expense_id, 91);
    assert.equal(result.body.expense.amount, 37.5);
    const lock = calls.find((call) => /FOR UPDATE/.test(call.sql));
    assert.ok(lock);
    const insert = calls.find((call) => /INSERT INTO expenses/.test(call.sql));
    assert.deepEqual(insert.values, [
      '2026-11-14',
      'Inventory purchase: Serum (quantity 3)',
      37.5,
      'INV-PURCHASE-11',
      7,
    ]);
    const update = calls.find((call) => /UPDATE inventory_purchase_records/.test(call.sql));
    assert.match(update.sql, /review_status = 'approved'/);
    assert.deepEqual(update.values, [91, 7, 11]);
    assert.equal(calls.some((call) => /UPDATE inventory_products/.test(call.sql)), false);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('purchase rejection requires a reason and only updates review audit fields', async () => {
  const originalTransaction = db.transaction;
  let transactionCount = 0;
  const calls = [];
  db.transaction = async (callback) => {
    transactionCount += 1;
    return callback({
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/FOR UPDATE/.test(sql)) {
          return { rows: [{ purchase_id: 11, expense_id: null, review_status: 'pending' }] };
        }
        assert.match(sql, /UPDATE inventory_purchase_records/);
        assert.deepEqual(values, ['Duplicate invoice row', 7, 11]);
        return { rows: [{
          purchase_id: 11,
          review_status: 'rejected',
          rejection_reason: values[0],
          rejected_by: values[1],
        }] };
      },
    });
  };

  try {
    const handler = routeHandler('/inventory-purchase-suggestions/:id/reject', 'post');
    const invalid = await invoke(handler, {
      params: { id: '11' },
      session: { userId: 7 },
      body: { reason: '   ' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(transactionCount, 0);

    const rejected = await invoke(handler, {
      params: { id: '11' },
      session: { userId: 7 },
      body: { reason: 'Duplicate invoice row' },
    });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.body.review_status, 'rejected');
    assert.equal(rejected.body.rejection_reason, 'Duplicate invoice row');
    assert.equal(transactionCount, 1);
    assert.equal(calls.some((call) => /INSERT INTO expenses/.test(call.sql)), false);
    assert.equal(calls.some((call) => /UPDATE inventory_products/.test(call.sql)), false);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('duplicate purchase approvals conflict without creating another expense', async () => {
  const originalTransaction = db.transaction;
  let insertCount = 0;
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      if (/FOR UPDATE/.test(sql)) {
        return { rows: [{
          purchase_id: 11,
          expense_id: 91,
          review_status: 'approved',
        }] };
      }
      if (/INSERT INTO expenses/.test(sql)) {
        insertCount += 1;
        return { rows: [{ expense_id: 92 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const result = await invoke(routeHandler('/inventory-purchase-suggestions/:id/approve', 'post'), {
      params: { id: '11' },
      session: { userId: 7 },
    });
    assert.equal(result.statusCode, 409);
    assert.equal(insertCount, 0);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('concurrent purchase approvals serialize and create exactly one expense', async () => {
  const originalTransaction = db.transaction;
  let lockTail = Promise.resolve();
  let status = 'pending';
  let expenseId = null;
  let insertCount = 0;
  let nextExpenseId = 90;

  db.transaction = async (callback) => {
    let unlock;
    let releaseLock;
    const client = {
      query: async (sql) => {
        if (/FOR UPDATE/.test(sql)) {
          const previous = lockTail;
          lockTail = new Promise((resolve) => { unlock = resolve; });
          await previous;
          releaseLock = unlock;
          return { rows: [{
            purchase_id: 11,
            product_name: 'Serum',
            quantity: 3,
            unit_price: '12.50',
            total_cost: '37.50',
            purchase_date: '2026-11-14',
            expense_id: expenseId,
            review_status: status,
          }] };
        }
        if (/pg_advisory_xact_lock/.test(sql) || /cash_closings/.test(sql)) return { rows: [] };
        if (/INSERT INTO expenses/.test(sql)) {
          insertCount += 1;
          nextExpenseId += 1;
          return { rows: [{ expense_id: nextExpenseId, amount: 37.5 }] };
        }
        if (/UPDATE inventory_purchase_records/.test(sql)) {
          expenseId = 91;
          status = 'approved';
          return { rows: [{ purchase_id: 11, review_status: status }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    try {
      return await callback(client);
    } finally {
      releaseLock?.();
    }
  };

  try {
    const handler = routeHandler('/inventory-purchase-suggestions/:id/approve', 'post');
    const request = () => invoke(handler, {
      params: { id: '11' },
      session: { userId: 7 },
    });
    const results = await Promise.all([request(), request()]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 409]);
    assert.equal(insertCount, 1);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('purchase review migration adds and backfills review and rejection audit fields', async () => {
  const migration = require('../migrations/053-finance-inventory-purchase-review');
  const originalTransaction = db.transaction;
  let migrationSql = '';
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      migrationSql = sql;
      return { rows: [] };
    },
  });

  try {
    await migration();
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS review_status/);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS rejected_by/);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS rejection_reason/);
    assert.match(migrationSql, /WHEN expense_id IS NOT NULL THEN 'approved'/);
    assert.match(migrationSql, /review_status = 'rejected'/);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('client payment history scopes all returned payments to the requested customer', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM users/.test(sql)) {
      return { rows: [{ user_id: 19, name: 'Client One', email: 'client@example.test' }] };
    }
    return { rows: [{ payment_id: 7, appointment_id: 42, amount: 1500 }] };
  };

  try {
    const result = await invoke(routeHandler('/clients/:id/payment-history', 'get'), {
      params: { id: '19' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.client.user_id, 19);
    assert.equal(result.body.rows.length, 1);
    assert.match(calls[1].sql, /appointment\.user_id = \$1 AND appointment\.is_demo = FALSE/);
    assert.match(calls[1].sql, /OR payment\.customer_id = \$1/);
    assert.deepEqual(calls.map((call) => call.values), [[19], [19]]);
  } finally {
    db.query = originalQuery;
  }
});

test('payment details include a linked product-sale client payment history', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/WHERE p\.payment_id = \$1/.test(sql)) {
      return { rows: [{
        payment_id: 27,
        appointment_id: null,
        customer_id: 19,
        payment_type: 'product_sale',
        amount: 25,
        method: 'cash',
        status: 'posted',
      }] };
    }
    return { rows: [{ payment_id: 27, payment_type: 'product_sale', amount: 25, status: 'posted' }] };
  };

  try {
    const result = await invoke(routeHandler('/payments/:id', 'get'), {
      params: { id: '27' },
      query: {},
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.history.length, 1);
    assert.deepEqual(calls[1].values, [19]);
    assert.match(calls[1].sql, /payment\.customer_id = \$1/);
  } finally {
    db.query = originalQuery;
  }
});

test('sale client list returns active clients with selectable user ids', async () => {
  const originalQuery = db.query;
  let sql = '';
  db.query = async (query) => {
    sql = query;
    return { rows: [{ user_id: 19, name: 'Client One', email: 'client@example.test' }] };
  };

  try {
    const result = await invoke(routeHandler('/clients', 'get'), {});
    assert.equal(result.statusCode, 200);
    assert.equal(result.body[0].user_id, 19);
    assert.match(sql, /role = 'client' AND status = 'active'/);
  } finally {
    db.query = originalQuery;
  }
});

test('product sale can be associated with an active client', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/SELECT payment\.payment_id/.test(sql)) return { rows: [] };
      if (/SELECT user_id FROM users/.test(sql)) return { rows: [{ user_id: 19 }] };
      if (/SELECT product_id, product_name, stock_quantity/.test(sql)) {
        return { rows: [{ product_id: 4, product_name: 'Serum', stock_quantity: 8 }] };
      }
      if (/INSERT INTO payments/.test(sql)) {
        return { rows: [{ payment_id: 27, payment_type: 'product_sale', amount: 25 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const result = await invoke(routeHandler('/product-sales', 'post'), {
      body: {
        request_key: '123e4567-e89b-42d3-a456-426614174000',
        product_id: 4,
        customer_id: 19,
        quantity: 1,
        unit_price: 25,
        method: 'gcash',
      },
      session: { userId: 3 },
    });
    assert.equal(result.statusCode, 201);
    const insert = calls.find((call) => /INSERT INTO payments/.test(call.sql));
    assert.match(insert.sql, /customer_id/);
    assert.equal(insert.values[0], 19);
    assert.deepEqual(calls.find((call) => /SELECT user_id FROM users/.test(call.sql)).values, [19]);
  } finally {
    db.transaction = originalTransaction;
  }
});
