const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorker } = require('tesseract.js');

const cachePath = path.join(os.tmpdir(), 'skin-goddess-tesseract');
fs.mkdirSync(cachePath, { recursive: true });

let workerPromise = null;
let recognitionQueue = Promise.resolve();

function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker('eng', 1, { cachePath }).catch(error => {
            workerPromise = null;
            throw error;
        });
    }
    return workerPromise;
}

function recognizeImage(imageBuffer) {
    const recognition = recognitionQueue.then(async () => {
        const worker = await getWorker();
        const result = await worker.recognize(imageBuffer);
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

module.exports = { recognizeImage, terminateWorker };
