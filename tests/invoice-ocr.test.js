const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreRecognition } = require('../utils/invoiceOcr');

test('scores clearly parsed invoice rows above OCR text with uncertain values', () => {
    const clearInvoice = [
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        '12 pcs | Hyaluronic Acid Serum 30ml 08/15/2028 385.00 4,620.00'
    ].join('\n');
    const uncertainInvoice = [
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        '12 pcs | Serum 08/15/2028 385.00 9,000.00'
    ].join('\n');

    assert.ok(scoreRecognition(clearInvoice, 50) > scoreRecognition(uncertainInvoice, 100));
});

test('scores additional clearly parsed rows above confidence alone', () => {
    const oneRow = [
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        '12 pcs | Hyaluronic Acid Serum 30ml 08/15/2028 385.00 4,620.00'
    ].join('\n');
    const twoRows = [
        oneRow,
        '10 pes | Vitamin C Brightening Serum 30ml 03/31/2028 420.00 4,200.00'
    ].join('\n');

    assert.ok(scoreRecognition(twoRows, 10) > scoreRecognition(oneRow, 100));
});
