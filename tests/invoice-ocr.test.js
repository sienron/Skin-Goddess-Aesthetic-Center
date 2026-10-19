const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
    preprocessInvoiceImage,
    scoreRecognition
} = require('../utils/invoiceOcr');

test('preprocesses photos with EXIF orientation, readable grayscale, and a bounded size', async () => {
    const photo = await sharp({
        create: {
            width: 3600,
            height: 1800,
            channels: 3,
            background: { r: 235, g: 230, b: 220 }
        }
    })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

    const processed = await preprocessInvoiceImage(photo);
    const metadata = await sharp(processed).metadata();
    const { data, info } = await sharp(processed)
        .raw()
        .toBuffer({ resolveWithObject: true });

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 3200);
    assert.equal(info.channels, 3);
    assert.equal(data[0], data[1]);
    assert.equal(data[1], data[2]);
});

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
