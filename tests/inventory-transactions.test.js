const test = require('node:test');
const assert = require('node:assert/strict');
const { recordInventoryTransaction } = require('../utils/inventoryTransactions');

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
