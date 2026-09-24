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
        expiry_date
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

module.exports = router;