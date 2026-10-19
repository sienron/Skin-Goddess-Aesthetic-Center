const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInvoiceText } = require('../utils/invoiceParser');

test('parses quantity-first invoice rows and excludes expiry dates from price parsing', () => {
    const rows = parseInvoiceText([
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        '12 pcs | Hyaluronic Acid Serum 30m 08/15/2028 385.00 4,620.00',
        '10 pes | Vitamin C Brightening Serum 30mi 03/31/2028 420.00 4,200.00',
        '24 pcs | Sunscreen SPF50 PA+++ 50g 11/30/2027 295.00 7,080.00',
        '20 pes | Collagen Sheet Mask 06/30/2027 48.50 970.00',
        '5 btl Gentle Foam Cleanser 150ml 12/15/2026 330.00 1,650.00',
        '8 pes | Niacinamide Toner 120m! 09/30/2027 360.00 2,880.00',
        '15 pes | Aloe Soothing Gel 200g 02/28/2028 175.00 2,625.00',
        '4 bt | Retinol Night Cream 50g 05/31/2028 640.00 2,560.00',
        'TOTAL AMOUNT DUE PHP 26,585.00',
        '“1 oT'
    ].join('\n'));

    assert.equal(rows.length, 8);
    assert.deepEqual(rows.map(row => [
        row.product_name,
        row.quantity,
        row.unit_price,
        row.expiry_date,
        row.needsReview
    ]), [
        ['Hyaluronic Acid Serum 30m', 12, 385, '2028-08-15', false],
        ['Vitamin C Brightening Serum 30mi', 10, 420, '2028-03-31', false],
        ['Sunscreen SPF50 PA+++ 50g', 24, 295, '2027-11-30', false],
        ['Collagen Sheet Mask', 20, 48.5, '2027-06-30', false],
        ['Gentle Foam Cleanser 150ml', 5, 330, '2026-12-15', false],
        ['Niacinamide Toner 120m!', 8, 360, '2027-09-30', false],
        ['Aloe Soothing Gel 200g', 15, 175, '2028-02-28', false],
        ['Retinol Night Cream 50g', 4, 640, '2028-05-31', false]
    ]);
});

test('parses product-first delivery receipt rows with ISO expiry dates', () => {
    const rows = parseInvoiceText([
        'DERMA CLINIC DEPOT',
        '45 Sample Ave., Brgy. Sample, Dasmarinas, Cavite 4114',
        'DELIVERY RECEIPT No. 12907',
        'Sold to: Skin-Goddess Aesthetic Center Date: October 08, 2026',
        'Address: Imus, Cavite Ref. No.: DR-3341',
        'PRODUCT QUANTITY UNIT PRICE CATEGORY EXPIRY DATE',
        'Hyaluronic Acid Serum 30ml 12 385.00 Serum 2028-08-15',
        'Vitamin C Brightening Serum 30ml 10 420.00 Serum 2028-03-31',
        'Sunscreen SPF50 PA+++ 50g 24 295.00 Sunscreen 2027-11-30',
        'Collagen Sheet Mask 20 48.50 Mask 2027-06-30',
        'Gentle Foam Cleanser 150ml 5 330.00 Cleanser 2026-12-15',
        'Niacinamide Toner 120ml 8 360.00 Toner 2027-09-30',
        'Disposable Gloves M 100s. 3 215.00 Supplies 2029-01-31',
        'Cotton Pads 100s 6 65.00 Supplies 2028-10-31',
        'Alcohol 70% 500ml 4 98.00 Supplies 2027-04-30',
        'TOTAL AMOUNT DUE PHP 22,827.00'
    ].join('\n'));

    assert.deepEqual(rows.map(row => [
        row.product_name,
        row.quantity,
        row.unit_price,
        row.expiry_date,
        row.needsReview
    ]), [
        ['Hyaluronic Acid Serum 30ml', 12, 385, '2028-08-15', false],
        ['Vitamin C Brightening Serum 30ml', 10, 420, '2028-03-31', false],
        ['Sunscreen SPF50 PA+++ 50g', 24, 295, '2027-11-30', false],
        ['Collagen Sheet Mask', 20, 48.5, '2027-06-30', false],
        ['Gentle Foam Cleanser 150ml', 5, 330, '2026-12-15', false],
        ['Niacinamide Toner 120ml', 8, 360, '2027-09-30', false],
        ['Disposable Gloves M 100s.', 3, 215, '2029-01-31', false],
        ['Cotton Pads 100s', 6, 65, '2028-10-31', false],
        ['Alcohol 70% 500ml', 4, 98, '2027-04-30', false]
    ]);
});

test('keeps unclear quantity values for review rather than treating invoice amount as quantity', () => {
    const rows = parseInvoiceText([
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        'pes | Niacinamide Toner 120ml 09/30/2027 360.00 2,880.00'
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].product_name, 'Niacinamide Toner 120ml');
    assert.equal(rows[0].quantity, null);
    assert.equal(rows[0].unit_price, 360);
    assert.equal(rows[0].expiry_date, '2027-09-30');
    assert.equal(rows[0].needsReview, true);
});

test('parses month-name expiry dates and ignores invalid calendar dates', () => {
    const rows = parseInvoiceText([
        'QTY UNIT DESCRIPTION EXP. DATE UNIT PRICE AMOUNT',
        '1 pcs Serum 15 Aug 2028 100.00 100.00',
        '2 pcs Cream 31 Feb 2028 200.00 400.00'
    ].join('\n'));

    assert.equal(rows[0].expiry_date, '2028-08-15');
    assert.equal(rows[1].expiry_date, null);
});

test('uses the item table boundaries and joins descriptions with OCR-split rows', () => {
    const rows = parseInvoiceText([
        '45 Sample Ave., Brgy. Sample, Cavite 4114',
        'DELIVERY RECEIPT No. 12907',
        'QTY UNIT ARTICLES PRICE AMOUNT',
        'Sunscreen SPF50 PA+++ 50g',
        '24 pcs Exp: 30 Nov 2027 295.00 7,080.00',
        '6 box Cotton Pads 100s 65.00 390.00',
        'Exp: 31 Oct 2028',
        'Collagen Sheet Mask',
        '20 pes Exp: 30 Jun 2027 48.50 970.00',
        '3 box Disposable Gloves M 100s 215.00 645.00',
        'Exp: 31 Jan 2029',
        'TOTAL AMOUNT DUE PHP 22,827.00',
        '17,980.00'
    ].join('\n'));

    assert.deepEqual(rows.map(row => [
        row.product_name,
        row.quantity,
        row.unit_price,
        row.expiry_date,
        row.needsReview
    ]), [
        ['Sunscreen SPF50 PA+++ 50g', 24, 295, '2027-11-30', false],
        ['Cotton Pads 100s', 6, 65, '2028-10-31', false],
        ['Collagen Sheet Mask', 20, 48.5, '2027-06-30', false],
        ['Disposable Gloves M 100s', 3, 215, '2029-01-31', false]
    ]);
});

test('keeps supplier details out and flags mismatched rows in quantity-first invoices', () => {
    const rows = parseInvoiceText([
        'GLOWMART TRADING CORP.',
        '88 Sample Rd, Brgy. Sample, Bacoor, Cavite 4102',
        'SALES INVOICE No. 078213',
        'Address: Imus, Cavite Ref. No.: S0-5520',
        'QTY UNIT ARTICLES PRICE AMOUNT',
        '1 pes | Hyaluronic Acid Serum 30mi 285.00 4620.00',
        'Exp: 15 Aug 2028',
        'Sunscreen SPFS0 PA+++ 50g',
        '24 pcs Exp: 30 Now 2027 295.00 7,080.00',
        '6 bot Cotton Pads 100s 65.00 300.00',
        'exp: 31 0012028',
        'Collagen Sheet Mask',
        '20 pcs Exp: 30 Jun 2027 48.50 970.00',
        '5 bt Gentle Foam Cleanser 150ml 330.00 1,650.00',
        'Exp: 15 Dec 2026',
        '3 box Disposable Gloves M 100s 215.00 645.00',
        'Aloe Soothing Gel 200g',
        '15 pcs Exp: 28 Feb 2028 175.00 2,625.00',
        'TOTAL AMOUNT DUE PHP 17,980.00'
    ].join('\n'));

    assert.deepEqual(rows.map(row => row.product_name), [
        'Hyaluronic Acid Serum 30mi',
        'Sunscreen SPFS0 PA+++ 50g',
        'Cotton Pads 100s',
        'Collagen Sheet Mask',
        'Gentle Foam Cleanser 150ml',
        'Disposable Gloves M 100s',
        'Aloe Soothing Gel 200g'
    ]);
    assert.ok(rows.every(row => !/sample|address|glowmart/i.test(row.product_name)));
    assert.equal(rows[0].needsReview, true);
    assert.equal(rows[0].quantity, 1);
    assert.equal(rows[0].unit_price, 285);
    assert.equal(rows[2].needsReview, true);
    assert.equal(rows[2].quantity, 6);
    assert.equal(rows[2].unit_price, 65);
});

test('parses all rows from quantity-first invoices without retaining OCR unit labels', () => {
    const rows = parseInvoiceText([
        'BELLEZA SUPPLY TRADING',
        '123 Sample Street, Brgy. Sample, Imus, Cavite 4103',
        'QTY UNIT DESCRIPTION UNIT PRICE AMOUNT',
        '12 pecs Hyaluronic Acid Serum 30m 385.00 4,620.00',
        '10 pes Vitamin C Brightening Serum 30m 420.00 4,200.00',
        '24 pcs Sunscreen SPF50 PA+++ 50g 295.00 7,080.00',
        '6 box Cotton Pads 100s 65.00 390.00',
        '20 pes Collagen Sheet Mask 48.50 970.00',
        '5 btl Gentle Foam Cleanser 150ml 330.00 1,650.00',
        '8 pes Niacinamide Toner 120ml 360.00 2,880.00',
        '3 box Disposable Gloves M 100s 215.00 645.00',
        '15 pes Aloe Soothing Gel 200g 175.00 2,625.00',
        '4 btl Alcohol 70% 500ml 98.00 392.00',
        'TOTAL AMOUNT DUE PHP 25,452.00'
    ].join('\n'));

    assert.deepEqual(rows.map(row => row.product_name), [
        'Hyaluronic Acid Serum 30m',
        'Vitamin C Brightening Serum 30m',
        'Sunscreen SPF50 PA+++ 50g',
        'Cotton Pads 100s',
        'Collagen Sheet Mask',
        'Gentle Foam Cleanser 150ml',
        'Niacinamide Toner 120ml',
        'Disposable Gloves M 100s',
        'Aloe Soothing Gel 200g',
        'Alcohol 70% 500ml'
    ]);
    assert.ok(rows.every(row => !/sample|belleza|street/i.test(row.product_name)));
    assert.ok(rows.every(row => !/^(?:pecs?|pes|pcs|btl|bl|bot)\b/i.test(row.product_name)));
    assert.equal(rows.every(row => !row.needsReview), true);
});

test('flags OCR values that conflict with the printed line amount', () => {
    const rows = parseInvoiceText([
        'QTY UNIT ARTICLES PRICE AMOUNT',
        '1 cs | Hyaluronic Acid Serum 30ml 285.00 4,620.00',
        'P Exp: 15 Aug 2028 §'
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].unit_price, 285);
    assert.equal(rows[0].expiry_date, '2028-08-15');
    assert.equal(rows[0].needsReview, true);
    assert.match(rows[0].reviewReason, /does not match quantity/);
});

test('recognizes compact unit-price headings and flags suspicious decimal loss', () => {
    const rows = parseInvoiceText([
        '45 Sample Ave., Brgy. Sample, Cavite 4114',
        'PRODUCT QUANTITY | UNITPRICE | CATEGORY EXPIRY DATE',
        'Hyaluronic Acid Serum 30ml 12 385.00 Serum 2028-08-15',
        'Disposable Gloves M 100s 3 21500 Supplies 2029-01-31',
        'TOTAL AMOUNT DUE PHP 27,000.00'
    ].join('\n'));

    assert.equal(rows.length, 2);
    assert.equal(rows[0].product_name, 'Hyaluronic Acid Serum 30ml');
    assert.equal(rows[0].quantity, 12);
    assert.equal(rows[0].unit_price, 385);
    assert.equal(rows[0].needsReview, false);
    assert.equal(rows[1].product_name, 'Disposable Gloves M 100s');
    assert.equal(rows[1].quantity, 3);
    assert.equal(rows[1].unit_price, 21500);
    assert.equal(rows[1].needsReview, true);
});
