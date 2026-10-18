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

router.get('/admin/:id/inventory-defaults', requireRole('admin'), async (req, res) => {
    const serviceId = Number(req.params.id);
    if (!Number.isSafeInteger(serviceId) || serviceId < 1) {
        return res.status(400).json({ message: 'Choose a valid service.' });
    }

    try {
        const result = await db.query(`
            SELECT mapping.product_id, product.product_name, product.category,
                   mapping.default_quantity, mapping.is_enabled, mapping.review_note
            FROM service_inventory_product_defaults mapping
            JOIN inventory_products product ON product.product_id = mapping.product_id
            WHERE mapping.service_id = $1
            ORDER BY product.category, product.product_name, product.product_id
        `, [serviceId]);
        return res.json(result.rows);
    } catch (error) {
        console.error('Error fetching service inventory defaults:', error);
        return res.status(500).json({ message: 'Could not load service product defaults.' });
    }
});

router.put('/admin/:id/inventory-defaults', requireRole('admin'), async (req, res) => {
    const serviceId = Number(req.params.id);
    if (!Number.isSafeInteger(serviceId) || serviceId < 1) {
        return res.status(400).json({ message: 'Choose a valid service.' });
    }
    const submittedProducts = req.body?.products;
    if (!Array.isArray(submittedProducts) || submittedProducts.length > 500) {
        return res.status(400).json({ message: 'The service product list is invalid.' });
    }

    const products = [];
    const productIds = new Set();
    for (const item of submittedProducts) {
        const productId = Number(item?.productId);
        const defaultQuantity = item?.defaultQuantity === null || item?.defaultQuantity === ''
            ? null
            : Number(item?.defaultQuantity);
        if (!Number.isSafeInteger(productId) || productId < 1
            || typeof item?.isEnabled !== 'boolean'
            || (defaultQuantity !== null
                && (!Number.isSafeInteger(defaultQuantity) || defaultQuantity < 1))
            || (item?.isEnabled === true && defaultQuantity === null)
            || productIds.has(productId)) {
            return res.status(400).json({
                message: 'Each enabled default must use a unique product and a confirmed positive whole-number quantity.'
            });
        }
        productIds.add(productId);
        products.push({
            productId,
            defaultQuantity,
            isEnabled: item.isEnabled,
            reviewNote: typeof item.reviewNote === 'string' ? item.reviewNote.slice(0, 500) : ''
        });
    }

    try {
        const savedDefaults = await db.transaction(async (client) => {
            const service = await client.query(
                'SELECT service_id FROM services WHERE service_id = $1 FOR UPDATE',
                [serviceId]
            );
            if (!service.rows.length) {
                const error = new Error('Service not found.');
                error.statusCode = 404;
                throw error;
            }
            if (productIds.size) {
                const inventoryProducts = await client.query(`
                    SELECT product_id
                    FROM inventory_products
                    WHERE product_id = ANY($1::integer[])
                `, [[...productIds]]);
                if (inventoryProducts.rows.length !== productIds.size) {
                    const error = new Error('One or more selected inventory products no longer exist.');
                    error.statusCode = 409;
                    throw error;
                }
            }

            await client.query(`
                UPDATE service_inventory_product_defaults
                SET is_enabled = FALSE, updated_by = $1, updated_at = NOW()
                WHERE service_id = $2
                  AND NOT (product_id = ANY($3::integer[]))
            `, [req.session.userId, serviceId, [...productIds]]);

            for (const product of products) {
                await client.query(`
                    INSERT INTO service_inventory_product_defaults
                      (service_id, product_id, default_quantity, is_enabled,
                       review_note, updated_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    ON CONFLICT (service_id, product_id)
                    DO UPDATE SET default_quantity = EXCLUDED.default_quantity,
                                  is_enabled = EXCLUDED.is_enabled,
                                  review_note = EXCLUDED.review_note,
                                  updated_by = EXCLUDED.updated_by,
                                  updated_at = NOW()
                `, [
                    serviceId,
                    product.productId,
                    product.defaultQuantity,
                    product.isEnabled,
                    product.reviewNote,
                    req.session.userId
                ]);
            }

            const result = await client.query(`
                SELECT mapping.product_id, product.product_name, product.category,
                       mapping.default_quantity, mapping.is_enabled, mapping.review_note
                FROM service_inventory_product_defaults mapping
                JOIN inventory_products product ON product.product_id = mapping.product_id
                WHERE mapping.service_id = $1
                ORDER BY product.category, product.product_name, product.product_id
            `, [serviceId]);
            return result.rows;
        });
        return res.json(savedDefaults);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
        console.error('Error saving service inventory defaults:', error);
        return res.status(500).json({ message: 'Could not save service product defaults.' });
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

router.put('/category-prices', requireRole('admin'), async (req, res) => {
    const category = String(req.body?.category || '').trim();
    const prices = req.body?.prices;
    if (!category || category.length > 255 || !Array.isArray(prices) || prices.length === 0) {
        return res.status(400).json({ message: 'Choose a service category and at least one service price.' });
    }

    const submittedPrices = new Map();
    for (const item of prices) {
        const serviceId = Number(item?.serviceId);
        const servicePrice = Number(item?.servicePrice);
        if (!Number.isSafeInteger(serviceId) || serviceId < 1
            || !Number.isFinite(servicePrice) || servicePrice <= 0 || servicePrice > 999999
            || submittedPrices.has(serviceId)) {
            return res.status(400).json({ message: 'Enter a valid price for each service.' });
        }
        submittedPrices.set(serviceId, servicePrice);
    }

    try {
        const updatedServices = await db.transaction(async (client) => {
            const categoryServices = await client.query(
                'SELECT service_id FROM services WHERE category = $1 FOR UPDATE',
                [category]
            );
            if (categoryServices.rows.length !== submittedPrices.size
                || categoryServices.rows.some((service) => !submittedPrices.has(service.service_id))) {
                const error = new Error('The services in this category have changed. Reload the page and try again.');
                error.statusCode = 409;
                throw error;
            }

            const updates = [];
            for (const [serviceId, servicePrice] of submittedPrices) {
                const result = await client.query(`
                    UPDATE services
                    SET service_price = $1, updated_at = NOW()
                    WHERE service_id = $2 AND category = $3
                    RETURNING service_id, service_name, service_price
                `, [servicePrice, serviceId, category]);
                updates.push(result.rows[0]);
            }
            return updates;
        });
        return res.json(updatedServices);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
        console.error('Error updating service category prices:', error);
        return res.status(500).json({ message: 'Could not update service prices.' });
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