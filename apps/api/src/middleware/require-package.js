'use strict';

const { pool } = require('../lib/db');
const { MERCHANT_PACKAGES } = require('../config/constants');

/**
 * Middleware vérifiant que le marchand a un package >= minPackage
 * CDC v3 §6.1 — Contrôle d'accès par tier de subscription
 */
function requirePackage(minPackage) {
  const tierOrder = MERCHANT_PACKAGES;
  const minIndex = tierOrder.indexOf(minPackage);

  return async (req, res, next) => {
    try {
      const merchantId = req.merchant?.id || req.params.merchantId || req.query.merchant_id;
      if (!merchantId) return res.status(400).json({ error: 'merchant_id requis' });

      const result = await pool.query('SELECT package FROM merchants WHERE id = $1', [merchantId]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

      const pkg = result.rows[0].package || 'STARTER_BOOST';
      const pkgIndex = tierOrder.indexOf(pkg);

      if (pkgIndex < minIndex) {
        return res.status(403).json({
          error: 'Package insuffisant',
          required: minPackage,
          current: pkg,
          upgrade_needed: true,
        });
      }

      req.merchantPackage = pkg;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePackage };
