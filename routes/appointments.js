const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
    const { serviceId, date, time } = req.body;

    if (!req.session.userId) {
        return res.status(401).json({ message: 'You must be logged in.' });
    }

    if (!Number.isInteger(Number(serviceId)) || !date || !time) {
        return res.status(400).json({ message: 'Service, date, and time are required.' });
    }

    const appointmentDate = date.year !== undefined
        ? `${date.year}-${String(Number(date.month) + 1).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
        : date;

    try {
        const serviceResult = await db.query(
            `SELECT service_price, reservation_fee
             FROM services
             WHERE service_id = $1 AND is_active = TRUE`,
            [Number(serviceId)]
        );

        if (serviceResult.rows.length === 0) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        const service = serviceResult.rows[0];
        const appointmentResult = await db.query(
            `INSERT INTO appointments
              (user_id, service_id, booked_service_price, booked_reservation_fee,
               appointment_date, appointment_time)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING appointment_id, service_id, appointment_date, appointment_time,
                       appointment_status, payment_status`,
            [
                req.session.userId,
                Number(serviceId),
                service.service_price,
                service.reservation_fee,
                appointmentDate,
                time,
            ]
        );

        res.status(201).json({
            message: 'Appointment created successfully.',
            appointment: appointmentResult.rows[0],
        });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ message: 'Could not create appointment.' });
    }
});

module.exports = router;