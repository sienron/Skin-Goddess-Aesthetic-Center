const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const inventoryRouter = require('../routes/inventory');
const {
  MAX_INVOICE_IMAGE_DIMENSION,
  MAX_INVOICE_UPLOAD_BYTES,
  validateAndNormalizeInvoiceImage,
} = require('../utils/invoiceUpload');

const scanRoute = inventoryRouter.stack.find(
  (layer) => layer.route?.path === '/batch-upload/scan' && layer.route.methods.post,
);
const uploadMiddleware = scanRoute.route.stack[0].handle;

async function createImage(format, width = 24, height = 16) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 210, g: 170, b: 80 },
    },
  })[format]().toBuffer();
}

async function withUploadServer(callback) {
  const app = express();
  app.post('/scan', uploadMiddleware, async (req, res) => {
    const metadata = await sharp(req.file.buffer).metadata();
    res.json({
      format: metadata.format,
      mimeType: req.file.mimetype,
      sourceHash: req.file.sourceHash,
      hasDiskPath: Boolean(req.file.path),
    });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function submitFile(port, bytes, mimeType, filename) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mimeType }), filename);
  return fetch(`http://127.0.0.1:${port}/scan`, { method: 'POST', body: form });
}

test('invoice upload decodes and re-encodes JPEG and PNG regardless of supplied MIME and filename', async () => {
  const jpeg = await createImage('jpeg');
  const png = await createImage('png');

  await withUploadServer(async (port) => {
    for (const [bytes, suppliedMime, suppliedFilename] of [
      [jpeg, 'image/png', '../../untrusted.png'],
      [png, 'image/jpeg', 'C:\\untrusted\\invoice.jpg'],
    ]) {
      const response = await submitFile(port, bytes, suppliedMime, suppliedFilename);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.format, 'png');
      assert.equal(body.mimeType, 'image/png');
      assert.equal(body.sourceHash, crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.equal(body.hasDiskPath, false);
    }
  });
});

test('invoice upload rejects unsupported and malformed data even when the client claims an allowed MIME type', async () => {
  const webp = await createImage('webp');
  const malformedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

  await withUploadServer(async (port) => {
    for (const bytes of [webp, malformedJpeg, Buffer.from('<svg></svg>')]) {
      const response = await submitFile(port, bytes, 'image/png', 'invoice.png');
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /invalid or unsupported/);
    }
  });
});

test('invoice image byte size and dimensions are bounded', async () => {
  await assert.rejects(
    validateAndNormalizeInvoiceImage(Buffer.alloc(MAX_INVOICE_UPLOAD_BYTES + 1)),
    { status: 413 },
  );

  const tooWide = await createImage('png', MAX_INVOICE_IMAGE_DIMENSION + 1, 1);
  await assert.rejects(
    validateAndNormalizeInvoiceImage(tooWide),
    /dimensions or format are not supported/,
  );
});
