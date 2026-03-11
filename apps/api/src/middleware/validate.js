'use strict';

/**
 * Middleware de validation générique avec Zod
 * Usage: router.post('/', validate(MySchema), handler)
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data; // remplace avec les données parsées/transformées
      next();
    } catch (err) {
      next(err); // passe à errorHandler qui gère ZodError
    }
  };
}

module.exports = { validate };
