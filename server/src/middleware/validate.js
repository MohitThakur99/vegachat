/**
 * Parses the listed parts of the request with zod and exposes the result as
 * `req.valid`. Handlers read only from `req.valid`, never from the raw
 * request, so nothing unvalidated reaches a service.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      const valid = req.valid ?? {};
      for (const part of ['params', 'query', 'body']) {
        if (schemas[part]) valid[part] = schemas[part].parse(req[part] ?? {});
      }
      req.valid = valid;
      next();
    } catch (err) {
      next(err);
    }
  };
}
