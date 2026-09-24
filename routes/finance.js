const express = require('express');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireRole('finance_officer', 'admin'));

module.exports = router;
