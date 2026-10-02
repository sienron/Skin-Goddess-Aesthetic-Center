const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { notifyRoles } = require('../utils/notifications');
const { LOW_STOCK_THRESHOLD, CRITICAL_STOCK_THRESHOLD } = require('../utils/inventoryThresholds');

router.use(requireRole('inventory_officer', 'admin'));

async function notifyStockTransition(previousStock, currentStock, productName) {
    let type;
    let severity;
    if (previousStock > CRITICAL_STOCK_THRESHOLD && currentStock <= CRITICAL_STOCK_THRESHOLD) {
        type = 'inventory_critical_stock';
        severity = 'critical';
    } else if (previousStock > LOW_STOCK_THRESHOLD && currentStock <= LOW_STOCK_THRESHOLD) {
        type = 'inventory_low_stock';
        severity = 'low';
    }

    if (type) {
        await notifyRoles(
            ['inventory_officer', 'admin'],
            type,
            `${severity === 'critical' ? 'URGENT: ' : ''}${productName} stock dropped to ${currentStock} units (${severity} stock alert).`,
        );
    }
}

async function updateInventoryProduct(productId, stock, details, userId) {
    return db.transaction(async (client) => {
        const current = await client.query(`
            SELECT stock_quantity
            FROM inventory_products
            WHERE product_id = $1
            FOR UPDATE
        `, [productId]);
        if (current.rows.length === 0) return null;

        const previousStock = Number(current.rows[0].stock_quantity);
        const result = details
            ? await client.query(`
                UPDATE inventory_products
                SET product_name = $1, category = $2, stock_quantity = $3,
                        expiry_date = $4, updated_at = NOW()
                WHERE product_id = $5
                RETURNING product_id, product_name, category, stock_quantity, expiry_date
            `, [details.product_name.trim(), details.category, stock, details.expiry_date || null, productId])
            : await client.query(`
                UPDATE inventory_products
                SET stock_quantity = $1, updated_at = NOW()
                WHERE product_id = $2
                RETURNING product_id, product_name, category, stock_quantity, expiry_date
            `, [stock, productId]);

        if (stock !== previousStock) {
            await client.query(`
                INSERT INTO inventory_transactions
                    (product_id, product_name, transaction_type, quantity, previous_stock, new_stock, created_by, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            `, [productId, result.rows[0].product_name, stock > previousStock ? 'Restock' : 'Used in Service', Math.abs(stock - previousStock), previousStock, stock, userId]);
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
                stock_transaction.transaction_type,
                stock_transaction.quantity,
                stock_transaction.previous_stock,
                stock_transaction.new_stock,
                stock_transaction.created_at,
                COALESCE(stock_transaction.product_name, product.product_name) AS product_name,
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
            WHERE transaction_type = 'Used in Service'
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

        const { stock } = req.body;


        // Check stock
        if (!Number.isInteger(stock) || stock < 0) {

            return res.status(400).json({
                message: 'Stock must be a non-negative integer.'
            });

        }


        const updated = await updateInventoryProduct(productId, stock, null, req.session.userId);
        if (!updated) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        await notifyStockTransition(updated.previousStock, stock, updated.product.product_name);
        res.json(updated.product);


    } catch (error) {

        console.error(
            'Error updating inventory stock:',
            error
        );

        res.status(500).json({
            message: 'Failed to update inventory stock.'
        });

    }

});


//PUT for editing an entire inventory product
router.put("/:id", async (req, res) => {

    try {

        const productId = Number(req.params.id);

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


        const updated = await updateInventoryProduct(productId, stock, {
            product_name,
            category,
            expiry_date
        }, req.session.userId);
        if (!updated) {
            return res.status(404).json({ message: "Product not found." });
        }

        await notifyStockTransition(updated.previousStock, stock, updated.product.product_name);
        res.json(updated.product);


    } catch (error) {

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