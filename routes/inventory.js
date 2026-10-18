const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { LOW_STOCK_THRESHOLD, CRITICAL_STOCK_THRESHOLD } = require('../utils/inventoryThresholds');
const { notifyStockTransition } = require('../utils/inventoryNotifications');
const { recordInventoryTransaction } = require('../utils/inventoryTransactions');
const { recognizeImage } = require('../utils/invoiceOcr');
const { parseInvoiceText, INVOICE_PARSER_CONFIG } = require('../utils/invoiceParser');

router.use(requireRole('inventory_officer', 'admin'));

const uploadInvoice = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, callback) {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
            return callback(new Error('Only JPEG and PNG invoice images are allowed.'));
        }
        callback(null, true);
    }
});

function handleInvoiceUpload(req, res, next) {
    uploadInvoice.single('image')(req, res, error => {
        if (!error) return next();

        const isTooLarge = error instanceof multer.MulterError
            && error.code === 'LIMIT_FILE_SIZE';
        const isInvalidType = error.message === 'Only JPEG and PNG invoice images are allowed.';
        return res.status(isTooLarge ? 413 : 400).json({
            message: isTooLarge
                ? 'The invoice image must be 10 MB or smaller.'
                : isInvalidType
                    ? error.message
                    : 'The invoice image could not be uploaded.'
        });
    });
}

function validExpiryDate(value) {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateBatchRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
        return 'Add between 1 and 500 reviewed invoice rows.';
    }

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return `Row ${index + 1} is invalid.`;
        }
        if (typeof row.product_name !== 'string' || !row.product_name.trim()
            || row.product_name.trim().length > 255) {
            return `Row ${index + 1} needs a product name of 1 to 255 characters.`;
        }
        if (!Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0) {
            return `Row ${index + 1} quantity must be a positive whole number.`;
        }
        if (row.unit_price === null || row.unit_price === undefined
            || row.unit_price === '' || !Number.isFinite(Number(row.unit_price))
            || Number(row.unit_price) < 0 || Number(row.unit_price) > 99999999.99) {
            return `Row ${index + 1} unit price must be a non-negative number.`;
        }
        if (typeof row.category !== 'string' || !row.category.trim()
            || row.category.trim().length > 100) {
            return `Row ${index + 1} needs a category of 1 to 100 characters.`;
        }
        if (!validExpiryDate(row.expiry_date)) {
            return `Row ${index + 1} expiration date must be a valid date.`;
        }
    }
    return null;
}

router.post('/batch-upload/scan', handleInvoiceUpload, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Select a JPEG or PNG invoice image to scan.' });
    }

    try {
        const rawText = await recognizeImage(req.file.buffer);
        if (rawText.trim().length < INVOICE_PARSER_CONFIG.minimumTextLength) {
            return res.status(422).json({
                message: 'We could not read enough text. Please retake the photo on a flat surface with good lighting.'
            });
        }

        const rows = parseInvoiceText(rawText);
        const names = [...new Set(rows
            .map(row => row.product_name.trim().toLowerCase())
            .filter(Boolean))];
        const existingResult = names.length
            ? await db.query(`
                SELECT product_id, product_name, category, stock_quantity,
                    expiry_date::text AS expiry_date
                FROM inventory_products
                WHERE LOWER(BTRIM(product_name)) = ANY($1::text[])
                ORDER BY product_id ASC
            `, [names])
            : { rows: [] };
        const existingProducts = new Map();
        existingResult.rows.forEach(product => {
            const key = product.product_name.trim().toLowerCase();
            if (!existingProducts.has(key)) existingProducts.set(key, product);
        });

        const reviewedRows = rows.map(row => {
            const existing = existingProducts.get(row.product_name.trim().toLowerCase());
            return existing
                ? {
                    ...row,
                    existing: true,
                    existingProductId: existing.product_id,
                    category: existing.category,
                    expiry_date: existing.expiry_date
                }
                : row;
        });

        const response = {
            rows: reviewedRows,
            source_hash: crypto.createHash('sha256').update(req.file.buffer).digest('hex')
        };
        if (process.env.OCR_RETURN_RAW_TEXT !== 'false') response.rawText = rawText;
        return res.json(response);
    } catch (error) {
        console.error('Invoice OCR scan failed:', error);
        return res.status(500).json({
            message: 'The invoice image could not be processed. Please try again with a clearer photo.'
        });
    }
});

router.post('/batch-upload/confirm', async (req, res) => {
    const validationError = validateBatchRows(req.body?.rows);
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }
    const requestKey = typeof req.body.request_key === 'string'
        ? req.body.request_key.toLowerCase()
        : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestKey)) {
        return res.status(400).json({ message: 'A valid batch request key is required.' });
    }
    const sourceHash = req.body.source_hash == null ? null : String(req.body.source_hash).toLowerCase();
    if (sourceHash !== null && !/^[0-9a-f]{64}$/.test(sourceHash)) {
        return res.status(400).json({ message: 'The invoice image fingerprint is invalid.' });
    }
    const normalizedRows = req.body.rows.map(row => ({
        product_name: row.product_name.trim(),
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price).toFixed(2),
        category: row.category.trim(),
        expiry_date: row.expiry_date || null
    }));
    const payloadHash = crypto.createHash('sha256')
        .update(JSON.stringify(normalizedRows))
        .digest('hex');

    try {
        const result = await db.transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`batch-request:${requestKey}`]);
            if (sourceHash) {
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`batch-image:${sourceHash}`]);
            }
            const existingBatches = await client.query(`
                SELECT purchase_batch_id, request_key, source_hash, payload_hash
                FROM inventory_purchase_batches
                WHERE request_key = $1 OR ($2::char(64) IS NOT NULL AND source_hash = $2)
                FOR UPDATE
            `, [requestKey, sourceHash]);
            const batchIds = new Set(existingBatches.rows.map(batch => batch.purchase_batch_id));
            if (batchIds.size > 1) {
                return { conflict: 'This request key and invoice image refer to different confirmed batches.' };
            }
            if (existingBatches.rows.length) {
                const existingBatch = existingBatches.rows[0];
                if (existingBatch.payload_hash.trim() !== payloadHash
                    || (existingBatch.request_key === requestKey
                        && (existingBatch.source_hash?.trim() || null) !== sourceHash)) {
                    return { conflict: 'This request was already confirmed with different purchase details. Start a new reviewed batch.' };
                }
                const existingProducts = await client.query(`
                    SELECT product.product_id, product.product_name, product.category,
                        product.stock_quantity, product.expiry_date::text AS expiry_date,
                        product.unit_price
                    FROM inventory_purchase_records purchase
                    JOIN inventory_products product ON product.product_id = purchase.product_id
                    WHERE purchase.purchase_batch_id = $1
                    ORDER BY purchase.row_number
                `, [existingBatch.purchase_batch_id]);
                return { products: existingProducts.rows, replayed: true };
            }

            const batch = await client.query(`
                INSERT INTO inventory_purchase_batches
                    (request_key, source_hash, payload_hash, created_by)
                VALUES ($1, $2, $3, $4)
                RETURNING purchase_batch_id
            `, [requestKey, sourceHash, payloadHash, req.session.userId]);
            const savedRows = [];

            for (const [index, row] of normalizedRows.entries()) {
                const productName = row.product_name.trim();
                const quantity = Number(row.quantity);
                const unitPrice = Number(row.unit_price);
                const expiryDate = row.expiry_date || null;
                const existingResult = await client.query(`
                    SELECT product_id, product_name, category, stock_quantity
                    FROM inventory_products
                    WHERE LOWER(BTRIM(product_name)) = LOWER(BTRIM($1))
                    ORDER BY product_id ASC
                    LIMIT 1
                    FOR UPDATE
                `, [productName]);

                if (existingResult.rows.length) {
                    const existing = existingResult.rows[0];
                    const previousStock = Number(existing.stock_quantity);
                    const newStock = previousStock + quantity;
                    const updated = await client.query(`
                        UPDATE inventory_products
                        SET stock_quantity = $1,
                            unit_price = $2,
                            expiry_date = COALESCE($3, expiry_date),
                            updated_at = NOW()
                        WHERE product_id = $4
                        RETURNING product_id, product_name, category, stock_quantity,
                            expiry_date::text AS expiry_date, unit_price
                    `, [newStock, unitPrice, expiryDate, existing.product_id]);
                    const transaction = await client.query(`
                        INSERT INTO inventory_transactions
                            (product_id, product_name, transaction_type, quantity,
                                previous_stock, new_stock, created_by, created_at)
                        VALUES ($1, $2, 'Restock', $3, $4, $5, $6, NOW())
                        RETURNING transaction_id
                    `, [
                        existing.product_id,
                        existing.product_name,
                        quantity,
                        previousStock,
                        newStock,
                        req.session.userId
                    ]);
                    await client.query(`
                        INSERT INTO inventory_purchase_records
                            (purchase_batch_id, row_number, inventory_transaction_id,
                                product_id, product_name, quantity, unit_price, purchase_date)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
                    `, [
                        batch.rows[0].purchase_batch_id,
                        index + 1,
                        transaction.rows[0].transaction_id,
                        existing.product_id,
                        existing.product_name,
                        quantity,
                        unitPrice
                    ]);
                    savedRows.push(updated.rows[0]);
                    continue;
                }

                const inserted = await client.query(`
                    INSERT INTO inventory_products
                        (product_name, category, stock_quantity, expiry_date, unit_price)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING product_id, product_name, category, stock_quantity,
                        expiry_date::text AS expiry_date, unit_price
                `, [productName, row.category.trim(), quantity, expiryDate, unitPrice]);
                const product = inserted.rows[0];
                const transaction = await client.query(`
                    INSERT INTO inventory_transactions
                        (product_id, product_name, transaction_type, quantity,
                            previous_stock, new_stock, created_by, created_at)
                    VALUES ($1, $2, 'Restock', $3, 0, $3, $4, NOW())
                    RETURNING transaction_id
                `, [product.product_id, product.product_name, quantity, req.session.userId]);
                await client.query(`
                    INSERT INTO inventory_purchase_records
                        (purchase_batch_id, row_number, inventory_transaction_id,
                            product_id, product_name, quantity, unit_price, purchase_date)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
                `, [
                    batch.rows[0].purchase_batch_id,
                    index + 1,
                    transaction.rows[0].transaction_id,
                    product.product_id,
                    product.product_name,
                    quantity,
                    unitPrice
                ]);
                savedRows.push(product);
            }

            return { products: savedRows, replayed: false };
        });

        if (result.conflict) return res.status(409).json({ message: result.conflict });
        return res.status(result.replayed ? 200 : 201).json({ products: result.products });
    } catch (error) {
        console.error('Invoice batch confirmation failed:', error);
        if (error.code === '42P01'
            && ['inventory_purchase_batches', 'inventory_purchase_records'].includes(error.table)) {
            return res.status(503).json({
                message: 'Purchase tracking is not installed. Run npm run migrate:finance-sales-purchases against the database configured for this server, then try again.'
            });
        }
        if (error.code === '42703' && error.column === 'product_name') {
            return res.status(503).json({
                message: 'The inventory transaction table is missing its product_name column. Run npm run migrate:inventory-transactions against the database configured for this server, then try again.'
            });
        }
        if (error.code === '42703' && error.column === 'unit_price') {
            return res.status(503).json({
                message: 'The inventory database is missing the unit_price column. Run npm run migrate:inventory-unit-price against the database configured for this server, then try again.'
            });
        }
        return res.status(500).json({
            message: 'The invoice rows could not be saved. No rows were added; please try again.'
        });
    }
});

async function updateInventoryProduct(productId, stockAdjustment, details, userId, targetStock = null) {
    return db.transaction(async (client) => {
        const current = await client.query(`
            SELECT stock_quantity
            FROM inventory_products
            WHERE product_id = $1
            FOR UPDATE
        `, [productId]);
        if (current.rows.length === 0) return null;

        const previousStock = Number(current.rows[0].stock_quantity);
        if (targetStock !== null && (!Number.isSafeInteger(targetStock) || targetStock < 0)) {
            const error = new Error('Stock quantity must be a non-negative whole number.');
            error.statusCode = 400;
            throw error;
        }
        const appliedStockAdjustment = targetStock === null
            ? stockAdjustment
            : targetStock - previousStock;
        const nextStock = previousStock + appliedStockAdjustment;
        if (nextStock < 0) {
            const error = new Error(`Stock cannot be reduced below zero. Current stock is ${previousStock}.`);
            error.statusCode = 409;
            throw error;
        }
        if (!Number.isSafeInteger(nextStock) || nextStock > 2147483647) {
            const error = new Error('The adjusted stock quantity is outside the supported range.');
            error.statusCode = 400;
            throw error;
        }
        const result = details
            ? await client.query(`
                UPDATE inventory_products
                SET product_name = $1, category = $2,
                    stock_quantity = stock_quantity + $3,
                    expiry_date = $4, updated_at = NOW()
                WHERE product_id = $5
                RETURNING product_id, product_name, category, stock_quantity, expiry_date
            `, [details.product_name.trim(), details.category, appliedStockAdjustment, details.expiry_date || null, productId])
            : await client.query(`
                UPDATE inventory_products
                SET stock_quantity = stock_quantity + $1, updated_at = NOW()
                WHERE product_id = $2 AND stock_quantity + $1 >= 0
                RETURNING product_id, product_name, category, stock_quantity, expiry_date
            `, [appliedStockAdjustment, productId]);

        if (Number(result.rows[0].stock_quantity) !== previousStock) {
            await recordInventoryTransaction(client, {
                productId,
                productName: result.rows[0].product_name,
                transactionType: targetStock === null
                    ? 'Adjustment'
                    : appliedStockAdjustment > 0
                      ? 'Restock'
                      : 'Manual Stock Deduction',
                quantity: Math.abs(appliedStockAdjustment),
                previousStock,
                newStock: Number(result.rows[0].stock_quantity),
                userId,
            });
        }

        return { product: result.rows[0], previousStock };
    });
}

router.get('/thresholds', (req, res) => {
    res.json({ lowStock: LOW_STOCK_THRESHOLD, criticalStock: CRITICAL_STOCK_THRESHOLD });
});

// GET all inventory products
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
                product.product_id,
                product.product_name,
                product.category,
                product.stock_quantity,
                product.expiry_date::text AS expiry_date,
                product.updated_at,
                COALESCE(
                    (
                        SELECT MAX(stock_change.created_at)
                        FROM inventory_transactions stock_change
                        WHERE stock_change.product_id = product.product_id
                            AND (
                                (
                                    product.stock_quantity > $1
                                    AND product.stock_quantity <= $2
                                    AND stock_change.new_stock > $1
                                    AND stock_change.new_stock <= $2
                                    AND (
                                        stock_change.previous_stock <= $1
                                        OR stock_change.previous_stock > $2
                                    )
                                )
                                OR (
                                    product.stock_quantity > 0
                                    AND product.stock_quantity <= $1
                                    AND stock_change.new_stock > 0
                                    AND stock_change.new_stock <= $1
                                    AND (
                                        stock_change.previous_stock = 0
                                        OR stock_change.previous_stock > $1
                                    )
                                )
                            )
                    ),
                    product.updated_at,
                    product.created_at
                ) AS stock_status_since
            FROM inventory_products product
            ORDER BY product.product_id ASC
        `, [CRITICAL_STOCK_THRESHOLD, LOW_STOCK_THRESHOLD]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({
      message: 'Failed to fetch inventory products.'
    });
  }
});

router.get('/transactions', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                stock_transaction.transaction_id,
                CASE
                    WHEN stock_transaction.transaction_type = 'Used in Service'
                         AND stock_transaction.appointment_id IS NULL
                    THEN 'Manual Stock Deduction'
                    ELSE stock_transaction.transaction_type
                END AS transaction_type,
                stock_transaction.quantity,
                stock_transaction.previous_stock,
                stock_transaction.new_stock,
                stock_transaction.created_at,
                COALESCE(
                    to_jsonb(stock_transaction)->>'product_name',
                    product.product_name
                ) AS product_name,
                COALESCE(
                    NULLIF(CONCAT_WS(' ', actor.first_name, actor.last_name), ''),
                    actor.email,
                    'Unknown'
                ) AS performed_by
            FROM inventory_transactions stock_transaction
            LEFT JOIN inventory_products product
                ON product.product_id = stock_transaction.product_id
            LEFT JOIN users actor
                ON actor.user_id = stock_transaction.created_by
            ORDER BY stock_transaction.created_at DESC, stock_transaction.transaction_id DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching inventory transactions:', error);
        res.status(500).json({
            message: 'Failed to fetch inventory transactions.'
        });
    }
});

// GET total units restocked today
router.get('/restocked-today', async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                COALESCE(SUM(quantity), 0) AS total_restocked
            FROM inventory_transactions
            WHERE transaction_type = 'Restock'
            AND created_at::date = CURRENT_DATE
        `);

        res.json({
            total_restocked:
                Number(result.rows[0].total_restocked)
        });

    } catch (error) {

        console.error(
            'Error fetching today\'s restocked units:',
            error
        );

        res.status(500).json({
            message: 'Failed to fetch today\'s restocked units.'
        });

    }

});

// GET total units deducted today
router.get('/deducted-today', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                COALESCE(SUM(quantity), 0) AS total_deducted
            FROM inventory_transactions
            WHERE transaction_type IN ('Used in Service', 'Manual Stock Deduction')
            AND created_at::date = CURRENT_DATE
        `);

        res.json({
            total_deducted:
                Number(result.rows[0].total_deducted)
        });

    } catch (error) {
        console.error(
            'Error fetching today\'s deducted units:',
            error
        );

        res.status(500).json({
            message: 'Failed to fetch today\'s deducted units.'
        });
    }
});

// GET number of products that became low stock today
router.get('/low-stock-today', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT COUNT(*) AS new_low_stock
            FROM inventory_transactions
            WHERE created_at::date = CURRENT_DATE
            AND new_stock > $1
            AND new_stock <= $2
            AND (
                previous_stock > $2
                OR previous_stock <= $1
            )
        `, [
            CRITICAL_STOCK_THRESHOLD,
            LOW_STOCK_THRESHOLD
        ]);

        res.json({
            new_low_stock: Number(result.rows[0].new_low_stock)
        });

    } catch (error) {
        console.error(
            'Error fetching today\'s new low-stock products:',
            error
        );

        res.status(500).json({
            message: 'Failed to fetch today\'s new low-stock products.'
        });
    }
});

// GET number of products that became critical stock today
router.get('/critical-stock-today', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT COUNT(*) AS new_critical_stock
            FROM inventory_transactions
            WHERE created_at::date = CURRENT_DATE
            AND new_stock > 0
            AND new_stock <= $1
            AND (
                previous_stock > $1
                OR previous_stock = 0
            )
            AND transaction_type != 'Adjustment'
        `, [CRITICAL_STOCK_THRESHOLD]);

        res.json({
            new_critical_stock:
                Number(result.rows[0].new_critical_stock)
        });

    } catch (error) {
        console.error(
            'Error fetching today\'s new critical-stock products:',
            error
        );

        res.status(500).json({
            message:
                'Failed to fetch today\'s new critical-stock products.'
        });
    }
});

router.get('/out-of-stock-today', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT COUNT(*) AS new_out_of_stock
            FROM inventory_transactions
            WHERE created_at::date = CURRENT_DATE
            AND new_stock = 0
            AND (
                previous_stock > 0
                OR transaction_type = 'Adjustment'
            )
        `);

        res.json({
            new_out_of_stock:
                Number(result.rows[0].new_out_of_stock)
        });

    } catch (error) {
        console.error(
            "Error fetching today's new out-of-stock count:",
            error
        );

        res.status(500).json({
            message:
                "Failed to fetch today's new out-of-stock count."
        });
    }
});

// POST for adding a new inventory product
router.post('/', async (req, res) => {
    try {
        const {
            product_name,
            category,
            stock,
            expiry_date
        } = req.body;

        // Check product name
        if (!product_name || product_name.trim() === "") {
            return res.status(400).json({
                message: "Product name is required."
            });
        }

        // Check stock
        if (!Number.isInteger(stock) || stock < 0) {
            return res.status(400).json({
                message: "Stock must be a non-negative integer."
            });
        }

        const result = await db.query(`
            INSERT INTO inventory_products
                (product_name, category, stock_quantity, expiry_date)
            VALUES
                ($1, $2, $3, $4)
            RETURNING
                product_id,
                product_name,
                category,
                stock_quantity,
                expiry_date
        `, [
            product_name.trim(),
            category,
            stock,
            expiry_date || null
        ]);
        
        // Record the initial stock as an adjustment
        if (stock >= 0) {
            await db.query(`
                INSERT INTO inventory_transactions
                    (product_id, product_name, transaction_type, quantity, previous_stock, new_stock, created_by, created_at)
                    VALUES ($1, $4, 'Adjustment', $2, 0, $2, $3, NOW())
            `, [
                result.rows[0].product_id,
                stock,
                    req.session.userId,
                    result.rows[0].product_name
            ]);
        }
        
        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error(
            "Error adding inventory product:",
            error
        );

        res.status(500).json({
            message: "Failed to add inventory product."
        });
    }
});

//PUT for updating inventory stock
router.put('/:id/stock', async (req, res) => {

    try {

        const productId = Number(req.params.id);

        const body = req.body || {};
        const hasTargetStock = Object.prototype.hasOwnProperty.call(body, 'stock');
        const { stock_adjustment: stockAdjustment, stock } = body;


        // Check stock
        if (hasTargetStock
            ? !Number.isSafeInteger(stock) || stock < 0
            : !Number.isSafeInteger(stockAdjustment)) {

            return res.status(400).json({
                message: 'Stock adjustment must be a whole number.'
            });

        }


        const updated = await updateInventoryProduct(
            productId,
            stockAdjustment || 0,
            null,
            req.session.userId,
            hasTargetStock ? stock : null
        );
        if (!updated) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        await notifyStockTransition(updated.previousStock, Number(updated.product.stock_quantity), updated.product.product_name);
        res.json(updated.product);


    } catch (error) {

        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }

        console.error(
            'Error updating inventory stock:',
            error
        );

        res.status(500).json({
            message: 'Failed to update inventory stock.'
        });

    }

});

router.post('/:id/deduct', async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId < 1) {
        return res.status(400).json({ message: 'Choose a valid inventory product.' });
    }

    try {
        const updated = await db.transaction(async (client) => {
            const current = await client.query(`
                SELECT product_name, stock_quantity
                FROM inventory_products
                WHERE product_id = $1
                FOR UPDATE
            `, [productId]);
            if (!current.rows.length) return null;

            const previousStock = Number(current.rows[0].stock_quantity);
            if (previousStock < 1) {
                const error = new Error(`${current.rows[0].product_name} is out of stock.`);
                error.statusCode = 409;
                throw error;
            }

            const result = await client.query(`
                UPDATE inventory_products
                SET stock_quantity = stock_quantity - 1, updated_at = NOW()
                WHERE product_id = $1 AND stock_quantity > 0
                RETURNING product_id, product_name, category, stock_quantity, expiry_date
            `, [productId]);
            if (!result.rows.length) {
                const error = new Error('Stock changed before it could be deducted. Refresh and try again.');
                error.statusCode = 409;
                throw error;
            }

            await recordInventoryTransaction(client, {
                productId,
                productName: result.rows[0].product_name,
                transactionType: 'Manual Stock Deduction',
                quantity: 1,
                previousStock,
                newStock: previousStock - 1,
                userId: req.session.userId
            });

            return {
                product: result.rows[0],
                previousStock
            };
        });
        if (!updated) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        try {
            await notifyStockTransition(
                updated.previousStock,
                Number(updated.product.stock_quantity),
                updated.product.product_name
            );
        } catch (error) {
            console.error(`Inventory threshold notification failed for product ${productId}:`, error);
        }
        return res.json(updated.product);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        if (error.code === '23514'
            && error.constraint === 'inventory_transactions_transaction_type_check') {
            return res.status(503).json({
                message: 'The inventory database is missing support for manual stock deductions. Run npm run migrate:manual-stock-deduction against this server database, then try again.'
            });
        }
        console.error('Error deducting inventory stock:', error);
        return res.status(500).json({ message: 'Failed to deduct inventory stock.' });
    }
});


//PUT for editing an entire inventory product
router.put("/:id", async (req, res) => {

    try {

        const productId = Number(req.params.id);

        const body = req.body || {};
        const hasTargetStock = Object.prototype.hasOwnProperty.call(body, 'stock');
        const {
            product_name,
            category,
            stock_adjustment: stockAdjustment,
            stock,
            expiry_date
        } = body;


        // Check product name
        if (!product_name || product_name.trim() === "") {

            return res.status(400).json({
                message: "Product name is required."
            });

        }


        // Check stock
        if (hasTargetStock
            ? !Number.isSafeInteger(stock) || stock < 0
            : !Number.isSafeInteger(stockAdjustment)) {

            return res.status(400).json({
                message: "Stock adjustment must be a whole number."
            });

        }


        const updated = await updateInventoryProduct(
            productId,
            stockAdjustment || 0,
            {
                product_name,
                category,
                expiry_date
            },
            req.session.userId,
            hasTargetStock ? stock : null
        );
        if (!updated) {
            return res.status(404).json({ message: "Product not found." });
        }

        await notifyStockTransition(updated.previousStock, Number(updated.product.stock_quantity), updated.product.product_name);
        res.json(updated.product);


    } catch (error) {

        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }

        console.error(
            "Error updating inventory product:",
            error
        );

        res.status(500).json({
            message: "Failed to update inventory product."
        });

    }

});

// DELETE an inventory product
router.delete('/:id', async (req, res) => {
    try {
        const productId = Number(req.params.id);

        if (!Number.isInteger(productId)) {
            return res.status(400).json({
                message: 'Invalid product ID.'
            });
        }

        const deletedProduct = await db.transaction(async (client) => {
            const current = await client.query(`
                SELECT product_id, product_name, stock_quantity
                FROM inventory_products
                WHERE product_id = $1
                FOR UPDATE
            `, [productId]);
            if (current.rows.length === 0) return null;

            const product = current.rows[0];
            await client.query(`
                INSERT INTO inventory_transactions
                    (product_id, product_name, transaction_type, quantity, previous_stock, new_stock, created_by, created_at)
                VALUES ($1, $2, 'Deleted', $3, $3, 0, $4, NOW())
            `, [productId, product.product_name, product.stock_quantity, req.session.userId]);

            await client.query(`
                DELETE FROM inventory_products
                WHERE product_id = $1
            `, [productId]);

            return {
                product_id: product.product_id,
                product_name: product.product_name
            };
        });

        if (!deletedProduct) {
            return res.status(404).json({
                message: 'Product not found.'
            });
        }

        res.json({
            message: 'Product deleted successfully.',
            product: deletedProduct
        });

    } catch (error) {
        console.error(
            'Error deleting inventory product:',
            error
        );

        res.status(500).json({
            message: 'Failed to delete inventory product.'
        });
    }
});

module.exports = router;