const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

function readServiceInput(body) {
    const serviceName = String(body.serviceName || '').trim();
    const category = String(body.category || '').trim();
    const description = String(body.description || '').trim();
    const durationMinutes = Number(body.durationMinutes);
    const servicePrice = Number(body.servicePrice);
    const reservationFee = Number(body.reservationFee);

    if (!serviceName || serviceName.length > 255) throw new Error('Enter a service name up to 255 characters.');
    if (!category || category.length > 255) throw new Error('Enter a category up to 255 characters.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new Error('Duration must be between 1 and 1440 minutes.');
    if (!Number.isFinite(servicePrice) || servicePrice <= 0 || servicePrice > 999999) throw new Error('Enter a valid service price.');
    if (!Number.isFinite(reservationFee) || reservationFee <= 0 || reservationFee > 999999) throw new Error('Enter a valid reservation fee.');

    return { serviceName, category, description, durationMinutes, servicePrice, reservationFee };
}

router.get('/admin', requireRole('admin'), async (req, res) => {
    try {
        const result = await db.query(
            'SELECT service_id, service_name, category, description, duration_minutes, service_price, reservation_fee, is_active FROM services ORDER BY category, service_name'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching admin services:', error);
        res.status(500).json({ message: 'Could not load services.' });
    }
});

router.post('/', requireRole('admin'), async (req, res) => {
    let service;
    try {
        service = readServiceInput(req.body);
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }

    try {
        const result = await db.query(`
            INSERT INTO services (service_name, category, description, duration_minutes, service_price, reservation_fee, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE)
            RETURNING service_id, service_name, category, description, duration_minutes, service_price, reservation_fee, is_active
        `, [service.serviceName, service.category, service.description, service.durationMinutes, service.servicePrice, service.reservationFee]);
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A service with that name already exists.' });
        console.error('Error creating service:', error);
        return res.status(500).json({ message: 'Could not create service.' });
    }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
    const serviceId = Number(req.params.id);
    if (!Number.isSafeInteger(serviceId) || serviceId < 1) return res.status(400).json({ message: 'Choose a valid service.' });

    let service;
    try {
        service = readServiceInput(req.body);
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }

    try {
        const result = await db.query(`
            UPDATE services
            SET service_name = $1, category = $2, description = $3, duration_minutes = $4,
                service_price = $5, reservation_fee = $6, updated_at = NOW()
            WHERE service_id = $7
            RETURNING service_id, service_name, category, description, duration_minutes, service_price, reservation_fee, is_active
        `, [service.serviceName, service.category, service.description, service.durationMinutes, service.servicePrice, service.reservationFee, serviceId]);
        if (!result.rows.length) return res.status(404).json({ message: 'Service not found.' });
        return res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A service with that name already exists.' });
        console.error('Error updating service:', error);
        return res.status(500).json({ message: 'Could not update service.' });
    }
});

router.patch('/:id/status', requireRole('admin'), async (req, res) => {
    const serviceId = Number(req.params.id);
    if (!Number.isSafeInteger(serviceId) || serviceId < 1) return res.status(400).json({ message: 'Choose a valid service.' });
    if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ message: 'Choose whether the service is published.' });

    try {
        const result = await db.query(`
            UPDATE services SET is_active = $1, updated_at = NOW()
            WHERE service_id = $2
            RETURNING service_id, is_active
        `, [req.body.isActive, serviceId]);
        if (!result.rows.length) return res.status(404).json({ message: 'Service not found.' });
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating service status:', error);
        return res.status(500).json({ message: 'Could not update service status.' });
    }
});

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