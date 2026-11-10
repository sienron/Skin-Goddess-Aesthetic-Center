const sharp = require('sharp');

const MAX_INVOICE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INVOICE_IMAGE_DIMENSION = 10000;
const MAX_INVOICE_IMAGE_PIXELS = 40_000_000;

class InvoiceImageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function matchesSupportedSignature(buffer) {
  const isJpeg = buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
  const isPng = buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return isJpeg || isPng;
}

async function validateAndNormalizeInvoiceImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new InvoiceImageError('The invoice image is invalid or unsupported.');
  }
  if (buffer.length > MAX_INVOICE_UPLOAD_BYTES) {
    throw new InvoiceImageError('The invoice image must be 10 MB or smaller.', 413);
  }
  if (!matchesSupportedSignature(buffer)) {
    throw new InvoiceImageError('The invoice image is invalid or unsupported.');
  }

  try {
    const image = sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_INVOICE_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    if (!['jpeg', 'png'].includes(metadata.format)
      || !Number.isInteger(metadata.width)
      || !Number.isInteger(metadata.height)
      || metadata.width > MAX_INVOICE_IMAGE_DIMENSION
      || metadata.height > MAX_INVOICE_IMAGE_DIMENSION
      || metadata.width * metadata.height > MAX_INVOICE_IMAGE_PIXELS) {
      throw new InvoiceImageError('The invoice image dimensions or format are not supported.');
    }

    const normalized = await sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_INVOICE_IMAGE_PIXELS,
    })
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer();
    return normalized;
  } catch (error) {
    if (error instanceof InvoiceImageError) throw error;
    throw new InvoiceImageError('The invoice image is malformed or could not be decoded.');
  }
}

module.exports = {
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_INVOICE_IMAGE_DIMENSION,
  MAX_INVOICE_IMAGE_PIXELS,
  InvoiceImageError,
  validateAndNormalizeInvoiceImage,
};
