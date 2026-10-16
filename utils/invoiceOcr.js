const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { parseInvoiceText } = require('./invoiceParser');

const cachePath = path.join(os.tmpdir(), 'skin-goddess-tesseract');
fs.mkdirSync(cachePath, { recursive: true });

const PAGE_SEGMENTATION_MODES = ['3', '4', '6'];
let workerPromise = null;
let recognitionQueue = Promise.resolve();

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
        const worker = await getWorker();
        let bestResult = null;
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const pageSegmentationMode of PAGE_SEGMENTATION_MODES) {
            await worker.setParameters({
                tessedit_pageseg_mode: pageSegmentationMode,
                preserve_interword_spaces: '1',
                user_defined_dpi: '300'
            });

            const result = await worker.recognize(imageBuffer, { rotateAuto: true });
            const score = scoreRecognition(result.data.text, result.data.confidence);
            if (score > bestScore) {
                bestResult = result;
                bestScore = score;
            }
        }

        return bestResult.data.text;
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

module.exports = { recognizeImage, scoreRecognition, terminateWorker };
