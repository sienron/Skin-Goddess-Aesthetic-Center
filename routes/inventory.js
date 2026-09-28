const express = require('express');
const router = express.Router();
const db = require('../db');

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


        // Get the current stock first
        const currentProduct = await db.query(`
            SELECT
                product_id,
                stock_quantity
            FROM inventory_products
            WHERE product_id = $1
        `, [productId]);


        if (currentProduct.rows.length === 0) {

            return res.status(404).json({
                message: 'Product not found.'
            });

        }


        const previousStock =
            currentProduct.rows[0].stock_quantity;
        
            const quantity =
                Math.abs(stock - previousStock);

            let transactionType;

            if (stock > previousStock) {

                transactionType = "Restock";

            }
            else if (stock < previousStock) {

                transactionType = "Used in Service";

            }
            else {

                transactionType = null;

            }


        // Calculate how much the stock changed
   


      


        // Update inventory stock
        const result = await db.query(`
            UPDATE inventory_products
            SET
                stock_quantity = $1,
                updated_at = NOW()
            WHERE product_id = $2
            RETURNING
                product_id,
                product_name,
                category,
                stock_quantity,
                expiry_date
        `, [stock, productId]);


        // Create transaction record
        // only when the stock actually changed
        if (transactionType) {

            await db.query(`
                INSERT INTO inventory_transactions
                    (
                        product_id,
                        transaction_type,
                        quantity,
                        previous_stock,
                        new_stock,
                        created_at
                    )
                VALUES
                    ($1, $2, $3, $4, $5, NOW())
            `, [
                productId,
                transactionType,
                quantity,
                previousStock,
                stock
            ]);

        }


        res.json(result.rows[0]);


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


        // Get the current stock before updating
        const currentProduct = await db.query(`
            SELECT
                product_id,
                stock_quantity
            FROM inventory_products
            WHERE product_id = $1
        `, [productId]);


        if (currentProduct.rows.length === 0) {

            return res.status(404).json({
                message: "Product not found."
            });

        }


        const previousStock =
            currentProduct.rows[0].stock_quantity;


        // Calculate the stock change
        const quantity =
            Math.abs(stock - previousStock);

        let transactionType;

        if (stock > previousStock) {

            transactionType = "Restock";

        }
        else if (stock < previousStock) {

            transactionType = "Used in Service";

        }
        else {

            transactionType = null;

        }


        // Update the entire inventory product
        const result = await db.query(`
            UPDATE inventory_products
            SET
                product_name = $1,
                category = $2,
                stock_quantity = $3,
                expiry_date = $4,
                updated_at = NOW()
            WHERE product_id = $5
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
            expiry_date || null,
            productId
        ]);


        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Product not found."
            });

        }


        // Create transaction record
        // only when the stock actually changed
        if (transactionType) {

            await db.query(`
                INSERT INTO inventory_transactions
                    (
                        product_id,
                        transaction_type,
                        quantity,
                        previous_stock,
                        new_stock,
                        created_at
                    )
                VALUES
                    ($1, $2, $3, $4, $5, NOW())
            `, [
                productId,
                transactionType,
                quantity,
                previousStock,
                stock
            ]);

        }


        res.json(result.rows[0]);


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