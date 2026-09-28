const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT service_id, service_name, category, description, duration_minutes, service_price, reservation_fee FROM services WHERE is_active = true ORDER BY category, service_name'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;