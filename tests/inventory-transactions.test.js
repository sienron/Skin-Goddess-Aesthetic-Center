const test = require('node:test');
const assert = require('node:assert/strict');
const { recordInventoryTransaction } = require('../utils/inventoryTransactions');
const db = require('../db');
const inventoryNotifications = require('../utils/inventoryNotifications');
const { migrate: enableManualStockDeductions } = require('../migrations/041-manual-stock-deduction');

const originalNotifyStockTransition = inventoryNotifications.notifyStockTransition;
inventoryNotifications.notifyStockTransition = async () => {};
const inventoryRouter = require('../routes/inventory');
inventoryNotifications.notifyStockTransition = originalNotifyStockTransition;

function getRouteHandler(path, method) {
    return inventoryRouter.stack
        .find(layer => layer.route?.path === path && layer.route.methods[method])
        .route.stack.at(-1).handle;
}

test('manual inventory transactions do not require the appointment_id column', async () => {
    const queries = [];
    const client = {
        async query(sql, values) {
            queries.push({ sql, values });
        }
    };

    await recordInventoryTransaction(client, {
        productId: 12,
        productName: '10cc Syringe',
        transactionType: 'Restock',
        quantity: 1,
        previousStock: 0,
        newStock: 1,
        userId: 7
    });

    assert.equal(queries.length, 1);
    assert.doesNotMatch(queries[0].sql, /appointment_id/);
    assert.deepEqual(queries[0].values, [
        12,
        '10cc Syringe',
        'Restock',
        1,
        0,
        1,
        7
    ]);
});

test('appointment inventory transactions retain their appointment_id', async () => {
    const queries = [];
    const client = {
        async query(sql, values) {
            queries.push({ sql, values });
        }
    };

    await recordInventoryTransaction(client, {
        productId: 12,
        productName: '10cc Syringe',
        transactionType: 'Used in Service',
        quantity: 1,
        previousStock: 2,
        newStock: 1,
        userId: 7,
        appointmentId: 42
    });

    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /appointment_id/);
    assert.equal(queries[0].values[7], 42);
});

test('manual stock reductions from the stock control and edit modal log Manual Stock Deduction', async () => {
    const originalTransaction = db.transaction;
    const transactionTypes = [];

    db.transaction = async callback => callback({
        async query(sql, values = []) {
            if (/SELECT stock_quantity\s+FROM inventory_products/.test(sql)) {
                return { rows: [{ stock_quantity: 5 }] };
            }
            if (/UPDATE inventory_products/.test(sql)) {
                return {
                    rows: [{
                        product_id: 12,
                        product_name: '10cc Syringe',
                        category: 'Medical/Injection Supplies',
                        stock_quantity: 4,
                        expiry_date: null
                    }]
                };
            }
            if (/INSERT INTO inventory_transactions/.test(sql)) {
                transactionTypes.push(values[2]);
                return { rows: [] };
            }
            return { rows: [] };
        }
    });

    try {
        for (const { path, body } of [
            { path: '/:id/stock', body: { stock: 4 } },
            {
                path: '/:id',
                body: {
                    stock: 4,
                    product_name: '10cc Syringe',
                    category: 'Medical/Injection Supplies',
                    expiry_date: null
                }
            }
        ]) {
            const handler = getRouteHandler(path, 'put');
            let responseBody;
            await handler({
                params: { id: '12' },
                body,
                session: { userId: 7 }
            }, {
                status() {
                    return this;
                },
                json(value) {
                    responseBody = value;
                    return this;
                }
            });
            assert.equal(responseBody.stock_quantity, 4);
        }
    } finally {
        db.transaction = originalTransaction;
    }

    assert.deepEqual(transactionTypes, ['Manual Stock Deduction', 'Manual Stock Deduction']);
});

test('stock minus deducts one unit and logs it atomically as a manual deduction', async () => {
    const originalTransaction = db.transaction;
    const queries = [];
    db.transaction = async callback => callback({
        async query(sql, values = []) {
            queries.push({ sql, values });
            if (/SELECT product_name, stock_quantity/.test(sql)) {
                return { rows: [{ product_name: '10cc Syringe', stock_quantity: 5 }] };
            }
            if (/UPDATE inventory_products\s+SET stock_quantity = stock_quantity - 1/.test(sql)) {
                return {
                    rows: [{
                        product_id: 12,
                        product_name: '10cc Syringe',
                        category: 'Medical/Injection Supplies',
                        stock_quantity: 4,
                        expiry_date: null
                    }]
                };
            }
            return { rows: [] };
        }
    });

    let statusCode = 200;
    let responseBody;
    try {
        const handler = getRouteHandler('/:id/deduct', 'post');
        await handler({
            params: { id: '12' },
            session: { userId: 7 }
        }, {
            status(code) {
                statusCode = code;
                return this;
            },
            json(value) {
                responseBody = value;
                return this;
            }
        });
    } finally {
        db.transaction = originalTransaction;
    }

    assert.equal(statusCode, 200);
    assert.equal(responseBody.stock_quantity, 4);
    const update = queries.find(({ sql }) => /UPDATE inventory_products/.test(sql));
    assert.deepEqual(update.values, [12]);
    const transaction = queries.find(({ sql }) => /INSERT INTO inventory_transactions/.test(sql));
    assert.deepEqual(transaction.values.slice(2, 7), [
        'Manual Stock Deduction',
        1,
        5,
        4,
        7
    ]);
});

test('stock minus rejects out-of-stock products without attempting a deduction', async () => {
    const originalTransaction = db.transaction;
    const queries = [];
    db.transaction = async callback => callback({
        async query(sql, values = []) {
            queries.push({ sql, values });
            if (/SELECT product_name, stock_quantity/.test(sql)) {
                return { rows: [{ product_name: '10cc Syringe', stock_quantity: 0 }] };
            }
            return { rows: [] };
        }
    });

    let statusCode = 200;
    let responseBody;
    try {
        const handler = getRouteHandler('/:id/deduct', 'post');
        await handler({
            params: { id: '12' },
            session: { userId: 7 }
        }, {
            status(code) {
                statusCode = code;
                return this;
            },
            json(value) {
                responseBody = value;
                return this;
            }
        });
    } finally {
        db.transaction = originalTransaction;
    }

    assert.equal(statusCode, 409);
    assert.match(responseBody.message, /out of stock/);
    assert.equal(queries.some(({ sql }) => /UPDATE inventory_products/.test(sql)), false);
    assert.equal(queries.some(({ sql }) => /INSERT INTO inventory_transactions/.test(sql)), false);
});

test('stock minus explains when the database transaction type constraint needs migration', async () => {
    const originalTransaction = db.transaction;
    db.transaction = async callback => callback({
        async query(sql) {
            if (/SELECT product_name, stock_quantity/.test(sql)) {
                return { rows: [{ product_name: '10cc Syringe', stock_quantity: 5 }] };
            }
            if (/UPDATE inventory_products/.test(sql)) {
                return {
                    rows: [{
                        product_id: 12,
                        product_name: '10cc Syringe',
                        category: 'Medical/Injection Supplies',
                        stock_quantity: 4,
                        expiry_date: null
                    }]
                };
            }
            const error = new Error('check constraint failed');
            error.code = '23514';
            error.constraint = 'inventory_transactions_transaction_type_check';
            throw error;
        }
    });

    let statusCode = 200;
    let responseBody;
    try {
        const handler = getRouteHandler('/:id/deduct', 'post');
        await handler({
            params: { id: '12' },
            session: { userId: 7 }
        }, {
            status(code) {
                statusCode = code;
                return this;
            },
            json(value) {
                responseBody = value;
                return this;
            }
        });
    } finally {
        db.transaction = originalTransaction;
    }

    assert.equal(statusCode, 503);
    assert.match(responseBody.message, /migrate:manual-stock-deduction/);
});

test('manual stock deduction migration preserves supported transaction types and enables manual deduction', async () => {
    const originalQuery = db.query;
    let migrationSql = '';
    db.query = async sql => {
        migrationSql = sql;
        return { rows: [] };
    };

    try {
        await enableManualStockDeductions();
    } finally {
        db.query = originalQuery;
    }

    assert.match(migrationSql, /DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check/);
    assert.match(migrationSql, /'Manual Stock Deduction'/);
    for (const transactionType of ['Restock', 'Used in Service', 'Adjustment', 'Expired', 'Deleted', 'Sale', 'Sale Reversed']) {
        assert.ok(migrationSql.includes(`'${transactionType}'`), `Migration should preserve ${transactionType}`);
    }
});
