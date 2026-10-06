/** Forwards a rejected promise from an async route handler to Express. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
