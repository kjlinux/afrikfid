const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { generateTokens, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AdminLoginSchema, MerchantLoginSchema } = require('../config/schemas');

// POST /api/v1/auth/admin/login
router.post('/admin/login', validate(AdminLoginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await db.query('SELECT * FROM admins WHERE email = $1 AND is_active = TRUE', [email]);
  const admin = result.rows[0];
  if (!admin) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  await db.query('UPDATE admins SET last_login = NOW() WHERE id = $1', [admin.id]);

  const tokens = generateTokens({ sub: admin.id, role: 'admin', email: admin.email });
  res.json({
    ...tokens,
    admin: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
  });
});

// POST /api/v1/auth/merchant/login
router.post('/merchant/login', validate(MerchantLoginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await db.query('SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE', [email]);
  const merchant = result.rows[0];
  if (!merchant || !merchant.password_hash) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  const tokens = generateTokens({ sub: merchant.id, role: 'merchant', email: merchant.email });
  res.json({
    ...tokens,
    merchant: {
      id: merchant.id, name: merchant.name, email: merchant.email,
      status: merchant.status, rebatePercent: merchant.rebate_percent,
    },
  });
});

// GET /api/v1/auth/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: { id: req.admin.id, email: req.admin.email, fullName: req.admin.full_name, role: req.admin.role } });
});

module.exports = router;
