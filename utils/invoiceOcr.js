const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { parseInvoiceText } = require('./invoiceParser');

const cachePath = path.join(os.tmpdir(), 'skin-goddess-tesseract');
fs.mkdirSync(cachePath, { recursive: true });

const MAX_OCR_IMAGE_DIMENSION = 3200;
let workerPromise = null;
let recognitionQueue = Promise.resolve();

async function preprocessInvoiceImage(imageBuffer) {
    return sharp(imageBuffer, { limitInputPixels: 100_000_000 })
        .rotate()
        .trim({
            background: { r: 0, g: 0, b: 0 },
            threshold: 16
        })
        .resize({
            width: MAX_OCR_IMAGE_DIMENSION,
            height: MAX_OCR_IMAGE_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true
        })
        .greyscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
}

function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker('eng', 1, { cachePath })
            .catch(error => {
                workerPromise = null;
                throw error;
            });
    }
    return workerPromise;
}

function scoreRecognition(text, confidence = 0) {
    const rows = parseInvoiceText(text);
    const clearRows = rows.filter(row => !row.needsReview).length;
    const reviewRows = rows.length - clearRows;
    const safeConfidence = Number.isFinite(confidence)
        ? Math.max(0, Math.min(100, confidence))
        : 0;

    return clearRows * 100 + reviewRows * 20 + safeConfidence / 10;
}

function recognizeImage(imageBuffer) {
    const recognition = recognitionQueue.then(async () => {
        const enhancedImage = await preprocessInvoiceImage(imageBuffer);
        const worker = await getWorker();
        await worker.setParameters({
            tessedit_pageseg_mode: '4',
            preserve_interword_spaces: '1',
            user_defined_dpi: '300'
        });

        const result = await worker.recognize(enhancedImage);
        return result.data.text;
    });
    recognitionQueue = recognition.then(() => undefined, () => undefined);
    return recognition;
}

async function terminateWorker() {
    await recognitionQueue;
    if (!workerPromise) return;

    const worker = await workerPromise;
    workerPromise = null;
    await worker.terminate();
}

module.exports = {
    preprocessInvoiceImage,
    recognizeImage,
    scoreRecognition,
    terminateWorker
};
