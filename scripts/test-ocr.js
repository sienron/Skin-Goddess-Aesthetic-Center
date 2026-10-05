const fs = require('node:fs');
const path = require('node:path');
const { recognizeImage, terminateWorker } = require('../utils/invoiceOcr');
const { parseInvoiceText } = require('../utils/invoiceParser');

async function main() {
    const imagePath = process.argv[2];
    if (!imagePath) {
        throw new Error('Usage: node scripts/test-ocr.js <image-path>');
    }

    const resolvedPath = path.resolve(imagePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Image file not found: ${resolvedPath}`);
    }

    const rawText = await recognizeImage(fs.readFileSync(resolvedPath));
    console.log('\nRaw OCR text:\n');
    console.log(rawText || '(No text recognized)');
    console.log('\nParsed rows:\n');
    console.table(parseInvoiceText(rawText));
}

main()
    .catch(error => {
        console.error('OCR test failed:', error.message);
        process.exitCode = 1;
    })
    .finally(terminateWorker);
