// Tune invoice vocabulary here when the client provides a real invoice sample.
const INVOICE_PARSER_CONFIG = {
    columnKeywords: [
        'description',
        'item',
        'qty',
        'quantity',
        'product name',
        'particulars',
        'unit price',
        'price',
        'amount'
    ],
    unitKeywords: [
        'pc',
        'pcs',
        'piece',
        'pieces',
        'bt',
        'box',
        'boxes',
        'cs',
        'case',
        'cases',
        'ctn',
        'btl',
        'bottle',
        'bottles',
        'pack',
        'packs',
        'set',
        'sets',
        'roll',
        'rolls',
        'tube',
        'tubes',
        'sachet',
        'sachets',
        'pair',
        'pairs',
        'unit',
        'units',
        'kg',
        'g',
        'ml',
        'pes'
    ],
    ignoreLineKeywords: [
        'total',
        'vat',
        'tin',
        'address',
        'invoice no',
        'invoice number',
        'invoice',
        'receipt',
        'subtotal',
        'cash',
        'change',
        'discount',
        'terms',
        'cashier',
        'customer',
        'thank you',
        'phone',
        'wholesale',
        'trading',
        'street',
        'sold to',
        'po no',
        'vatable',
        'received',
        'signature',
        'representative',
        'reg',
        'tel'
    ],
    minimumTextLength: 8
};

function parseNumberToken(token) {
    const normalized = token
        .replace(/^(?:₱|PHP|P|\$)/i, '')
        .replace(/,/g, '')
        .replace(/[Oo]/g, '0')
        .replace(/[Il]/g, '1')
        .replace(/[Ss]/g, '5');
    return normalized && /^\d+(?:\.\d{1,2})?$/.test(normalized)
        ? Number(normalized)
        : null;
}

function parseExpiryDate(line) {
    const monthNames = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
        october: 10, nov: 11, november: 11, dec: 12, december: 12
    };
    const monthPattern = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const datePattern = new RegExp(
        `\\b(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{1,2}\\s+${monthPattern}\\s+\\d{4}|${monthPattern}\\s+\\d{1,2},?\\s+\\d{4})\\b`,
        'i'
    );
    const match = line.match(datePattern);
    if (!match) return { date: null, text: line };

    const token = match[0];
    let year;
    let month;
    let day;
    let parts = token.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (parts) {
        [, year, month, day] = parts;
    } else if ((parts = token.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) {
        [, month, day, year] = parts;
    } else {
        parts = token.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/)
            || token.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
        if (!parts) return { date: null, text: line };
        if (/^\d/.test(parts[1])) {
            day = parts[1];
            month = monthNames[parts[2].toLowerCase()];
            year = parts[3];
        } else {
            month = monthNames[parts[1].toLowerCase()];
            day = parts[2];
            year = parts[3];
        }
    }

    const numericYear = Number(year);
    const numericMonth = Number(month);
    const numericDay = Number(day);
    const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
    const valid = numericYear >= 1000
        && date.getUTCFullYear() === numericYear
        && date.getUTCMonth() === numericMonth - 1
        && date.getUTCDate() === numericDay;
    return {
        date: valid ? date.toISOString().slice(0, 10) : null,
        text: line.replace(token, ' ')
    };
}

function parseInvoiceLine(line, hasAmountColumn) {
    const cleanedLine = line
        .replace(/[|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleanedLine) return null;

    const matchesKeyword = keyword =>
        new RegExp(`\\b${keyword}\\b`, 'i').test(cleanedLine);
    if (INVOICE_PARSER_CONFIG.ignoreLineKeywords.some(matchesKeyword)) {
        return null;
    }

    const hasColumnHeading = /\b(?:description|product name|particulars)\b/i.test(cleanedLine)
        || (INVOICE_PARSER_CONFIG.columnKeywords.some(matchesKeyword)
            && /\b(?:qty|quantity|unit\s*price|amount|exp\.?\s*date)\b/i.test(cleanedLine));
    if (hasColumnHeading) return null;

    const expiry = parseExpiryDate(cleanedLine);
    const tokens = expiry.text.split(/\s+/).filter(Boolean);
    const numberTokens = tokens
        .map((token, index) => ({
            index,
            value: parseNumberToken(token.replace(/[()]/g, ''))
        }))
        .filter(token => token.value !== null && !/^\d+s$/i.test(tokens[token.index]));
    if (!numberTokens.length) return null;

    const firstToken = tokens[0]?.toLowerCase().replace(/[.,]/g, '');
    const hasLeadingQuantity = /^\d/.test(tokens[0] || '')
        && numberTokens[0]?.index === 0;
    const hasLeadingUnit = INVOICE_PARSER_CONFIG.unitKeywords.includes(firstToken);
    let productName;
    let quantity = null;
    let unitPrice = null;
    let ambiguousQuantity = false;

    if (hasLeadingQuantity) {
        quantity = numberTokens[0].value;
        let productStart = 1;
        const unitLabel = tokens[productStart]?.toLowerCase().replace(/[.,]/g, '');
        if (INVOICE_PARSER_CONFIG.unitKeywords.includes(unitLabel)) productStart += 1;
        productName = tokens.slice(productStart, numberTokens.length >= 3
            ? numberTokens[numberTokens.length - 2].index
            : undefined).join(' ').trim();
        if (numberTokens.length >= 3) {
            unitPrice = numberTokens[numberTokens.length - 2].value;
            const amount = numberTokens[numberTokens.length - 1].value;
            if (Math.abs(quantity * unitPrice - amount) > Math.max(0.02, amount * 0.01)) {
                ambiguousQuantity = true;
            }
        } else if (numberTokens.length === 2) {
            unitPrice = numberTokens[1].value;
        }
    } else if (hasAmountColumn) {
        const priceIndex = numberTokens.length >= 2 ? numberTokens.length - 2 : 0;
        unitPrice = numberTokens[priceIndex]?.value ?? null;
        const productEnd = numberTokens[priceIndex]?.index ?? tokens.length;
        productName = tokens.slice(hasLeadingUnit ? 1 : 0, productEnd).join(' ').trim();
    } else {
        const quantityToken = numberTokens[0];
        const priceToken = numberTokens[1];
        if (priceToken) {
            quantity = quantityToken.value;
            unitPrice = priceToken.value;
            productName = tokens.slice(0, quantityToken.index).join(' ').trim();
        } else if (quantityToken.value % 1 !== 0) {
            unitPrice = quantityToken.value;
            productName = tokens.slice(0, quantityToken.index).join(' ').trim();
            ambiguousQuantity = true;
        } else {
            quantity = quantityToken.value;
            productName = tokens.slice(0, quantityToken.index).join(' ').trim();
            ambiguousQuantity = true;
        }
    }

    productName = (productName || '')
        .replace(/^[#*-]+/, '')
        .replace(/[|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const reasons = [];

    if (!productName) reasons.push('Product name could not be read.');
    if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
        reasons.push('Quantity must be a positive whole number.');
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        reasons.push('Unit price could not be read.');
    }
    if (ambiguousQuantity) {
        reasons.push(hasAmountColumn && numberTokens.length >= 3
            ? 'Line amount does not match quantity × unit price; verify the OCR values.'
            : 'Verify the quantity and unit price.');
    }
    if (unitPrice >= 10000) {
        reasons.push('Unit price is unusually high; verify the decimal point.');
    }

    return {
        product_name: productName,
        quantity,
        unit_price: unitPrice,
        category: '',
        expiry_date: expiry.date,
        existing: false,
        needsReview: reasons.length > 0,
        reviewReason: reasons.join(' ')
    };
}

function parseInvoiceText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const headerIndex = lines.findIndex(line =>
        /\b(?:qty|quantity)\b/i.test(line)
        && /\b(?:description|articles?|product|item|particulars)\b/i.test(line)
        && /\b(?:unit\s*price|price|amount)\b/i.test(line));
    const tableLines = headerIndex === -1 ? lines : lines.slice(headerIndex + 1);
    const hasAmountColumn = lines.some(line =>
        /\b(?:qty|quantity)\b/i.test(line) && /\bamount\b/i.test(line));
    const rows = [];
    let pendingProduct = '';

    for (const line of tableLines) {
        if (/\b(?:total amount due|vatable sales|subtotal)\b/i.test(line)) break;

        const expiry = parseExpiryDate(line);
        if (expiry.date && /\bexp(?:iry)?\.?\b/i.test(line) && !/\d/.test(expiry.text)) {
            if (rows.length) rows[rows.length - 1].expiry_date = expiry.date;
            continue;
        }
        if (/^\s*exp(?:iry)?\.?\b/i.test(line)) continue;

        const row = parseInvoiceLine(line, hasAmountColumn);
        if (!row) {
            const description = expiry.text
                .replace(/\bexp(?:iry)?\.?\s*:?\s*/i, ' ')
                .replace(/[|“”‘’§]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (description && /[A-Za-z]{2,}/.test(description)
                && !/\b(?:received|signature|representative)\b/i.test(description)) {
                pendingProduct = pendingProduct
                    ? `${pendingProduct} ${description}`.trim()
                    : description;
            }
            continue;
        }

        if (/^exp(?:iry)?\.?$/i.test(row.product_name)) continue;
        if (!row.product_name || /^exp(?:iry)?\.?\b/i.test(row.product_name)) {
            row.product_name = pendingProduct;
            pendingProduct = '';
        } else if (pendingProduct) {
            row.product_name = `${pendingProduct} ${row.product_name}`.trim();
            pendingProduct = '';
        }
        if (row.product_name) rows.push(row);
    }

    return rows;
}

module.exports = {
    INVOICE_PARSER_CONFIG,
    parseInvoiceText
};
