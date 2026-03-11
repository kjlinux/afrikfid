'use strict';

/**
 * Middleware de gestion d'erreurs centralisé
 * Doit être enregistré EN DERNIER dans Express (après toutes les routes)
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Erreurs de validation Zod
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Données invalides',
      details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // Erreurs JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token invalide' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Token expiré' });
  }

  // Erreurs de parsing JSON (corps malformé)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'Corps JSON malformé' });
  }

  // Erreur de contrainte SQLite (clé unique, clé étrangère, etc.)
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('UNIQUE constraint'))) {
    return res.status(409).json({ error: 'DUPLICATE_ENTRY', message: 'Ressource déjà existante' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || (err.message && err.message.includes('FOREIGN KEY'))) {
    return res.status(400).json({ error: 'INVALID_REFERENCE', message: 'Référence invalide' });
  }

  // Loguer les erreurs inattendues
  console.error('❌ Erreur non gérée:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
  });

  // Réponse générique
  res.status(err.status || 500).json({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Erreur interne du serveur',
  });
}

/**
 * Helper pour créer une erreur HTTP avec un statut
 */
function createError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

module.exports = { errorHandler, createError };
