import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { userSearchQuery } from '../validation/restSchemas.js';
import { searchUsers } from '../services/userService.js';

export const usersRouter = Router();

usersRouter.get(
  '/search',
  validate({ query: userSearchQuery }),
  asyncHandler(async (req, res) => {
    res.json({ users: await searchUsers(req.userId, req.valid.query.q) });
  }),
);
