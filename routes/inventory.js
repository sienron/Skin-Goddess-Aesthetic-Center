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

//PUT for updating inventory records
router.put('/:id/stock', async (req, res) => {

    try {

        const productId = Number(req.params.id);

        const { stock } = req.body;

        if (!Number.isInteger(stock) || stock < 0) {

            return res.status(400).json({
                message: 'Stock must be a non-negative integer.'
            });

        }

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

        if (result.rows.length === 0) {

            return res.status(404).json({
                message: 'Product not found.'
            });

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

//delete entire product
router.delete('/:id', async (req, res) => {

    try {

        const productId =
            Number(req.params.id);


        const result =
            await db.query(`
                DELETE FROM inventory_products
                WHERE product_id = $1
                RETURNING product_id
            `, [productId]);


        if(result.rows.length === 0){

            return res.status(404).json({
                message: 'Product not found.'
            });

        }


        res.json({
            message: 'Product deleted successfully.'
        });


    } catch(error){

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