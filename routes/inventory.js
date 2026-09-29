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

async function updateInventoryProduct(productId, stock, details) {
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
                    (product_id, transaction_type, quantity, previous_stock, new_stock, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [productId, stock > previousStock ? 'Restock' : 'Used in Service', Math.abs(stock - previousStock), previousStock, stock]);
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
        product_id,
        product_name,
        category,
        stock_quantity,
        expiry_date::text AS expiry_date
      FROM inventory_products
      ORDER BY product_id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({
      message: 'Failed to fetch inventory products.'
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


        const updated = await updateInventoryProduct(productId, stock);
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
        });
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

module.exports = router;