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
        'box',
        'boxes',
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
        'date',
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

function parseInvoiceLine(line) {
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

    const hasColumnHeading = matchesKeyword('description')
        || matchesKeyword('product name')
        || matchesKeyword('particulars')
        || (INVOICE_PARSER_CONFIG.columnKeywords.some(matchesKeyword)
            && /\b(?:qty|quantity|unit price|amount)\b/i.test(cleanedLine));
    if (hasColumnHeading) return null;

    const tokens = cleanedLine.split(/\s+/);
    const numberTokens = [];
    tokens.forEach((token, index) => {
        const candidate = token.replace(/[()]/g, '');
        if (/^\d+s$/i.test(candidate)) return;
        if (/^(?:₱|PHP|P|\$)?[\dOoIlSs][\dOoIlSs,]*(?:\.[\dOoIlSs]{1,2})?$/i.test(candidate)) {
            numberTokens.push({ index, value: parseNumberToken(candidate) });
        }
    });

    if (!numberTokens.length) {
        const words = cleanedLine.match(/[A-Za-z]{2,}/g) || [];
        if (words.length < 1 || words.length > 6 || cleanedLine.length > 80) return null;
        return {
            product_name: cleanedLine,
            quantity: null,
            unit_price: null,
            category: '',
            expiry_date: null,
            existing: false,
            needsReview: true,
            reviewReason: 'Quantity and unit price could not be read.'
        };
    }

    const firstNumber = numberTokens[0];
    const unitLabel = tokens[1]?.toLowerCase().replace(/[.,]/g, '');
    const isQuantityUnitDescriptionRow = firstNumber.index === 0
        && INVOICE_PARSER_CONFIG.unitKeywords.includes(unitLabel);
    const ambiguousQuantity = !isQuantityUnitDescriptionRow && numberTokens.length === 2;
    const quantity = firstNumber.value;
    let productName;
    let priceToken;

    if (isQuantityUnitDescriptionRow) {
        priceToken = numberTokens.length >= 3
            ? numberTokens[numberTokens.length - 2]
            : numberTokens[1];
        productName = tokens.slice(2, priceToken?.index)
            .join(' ')
            .trim();
    } else {
        productName = tokens.slice(0, firstNumber.index)
            .join(' ')
            .replace(/^[#*-]+/, '')
            .trim();
        priceToken = numberTokens.length >= 3
            ? numberTokens[numberTokens.length - 2]
            : numberTokens[1];
    }
    const unitPrice = priceToken ? priceToken.value : null;
    const reasons = [];

    if (!productName) reasons.push('Product name could not be read.');
    if (!Number.isInteger(quantity) || quantity <= 0) {
        reasons.push('Quantity must be a positive whole number.');
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        reasons.push('Unit price could not be read.');
    }
    if (ambiguousQuantity) {
        reasons.push('Only two numeric values were found; verify the quantity and unit price.');
    }
    if (numberTokens.length > 3) {
        reasons.push('Several numeric values were found; verify the quantity and unit price.');
    }

    return {
        product_name: productName,
        quantity,
        unit_price: unitPrice,
        category: '',
        expiry_date: null,
        existing: false,
        needsReview: reasons.length > 0,
        reviewReason: reasons.join(' ')
    };
}

function parseInvoiceText(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(parseInvoiceLine)
        .filter(Boolean);
}

module.exports = {
    INVOICE_PARSER_CONFIG,
    parseInvoiceText
};
