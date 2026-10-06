import { Router } from 'express';
import multer from 'multer';
import { Limits } from '../shared.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import {
  addMembersBody,
  changeRoleBody,
  conversationParams,
  createGroupBody,
  directBody,
  memberParams,
  messagesQuery,
  transferBody,
  updateGroupBody,
} from '../validation/restSchemas.js';
import { requireMembership } from '../services/access.js';
import { createAttachment } from '../services/attachmentService.js';
import * as conversationService from '../services/conversationService.js';
import * as groupService from '../services/groupService.js';
import { listMessages } from '../services/messageService.js';

// Held in memory so the content can be inspected before anything is written
// to disk; the size limit keeps that cheap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Limits.UPLOAD_MAX_BYTES, files: 1, fields: 0 },
});

const withConversation = validate({ params: conversationParams });
const withMember = validate({ params: memberParams });

// Mounted behind `authenticate`: every handler here has `req.userId`. What
// that user may do with the conversation is decided inside the service.
export const conversationsRouter = Router();

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ conversations: await conversationService.listConversations(req.userId) });
  }),
);

conversationsRouter.post(
  '/direct',
  validate({ body: directBody }),
  asyncHandler(async (req, res) => {
    const result = await conversationService.openDirectConversation(req.userId, req.valid.body.userId);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

conversationsRouter.post(
  '/group',
  validate({ body: createGroupBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await groupService.createGroup(req.userId, req.valid.body));
  }),
);

conversationsRouter.get(
  '/:conversationId',
  withConversation,
  asyncHandler(async (req, res) => {
    res.json(await conversationService.getConversationDetail(req.userId, req.valid.params.conversationId));
  }),
);

conversationsRouter.patch(
  '/:conversationId',
  withConversation,
  validate({ body: updateGroupBody }),
  asyncHandler(async (req, res) => {
    res.json(await groupService.updateGroup(req.userId, req.valid.params.conversationId, req.valid.body));
  }),
);

conversationsRouter.delete(
  '/:conversationId',
  withConversation,
  asyncHandler(async (req, res) => {
    await groupService.deleteGroup(req.userId, req.valid.params.conversationId);
    res.status(204).end();
  }),
);

conversationsRouter.get(
  '/:conversationId/messages',
  withConversation,
  validate({ query: messagesQuery }),
  asyncHandler(async (req, res) => {
    res.json(await listMessages(req.userId, req.valid.params.conversationId, req.valid.query));
  }),
);

conversationsRouter.post(
  '/:conversationId/members',
  withConversation,
  validate({ body: addMembersBody }),
  asyncHandler(async (req, res) => {
    const result = await groupService.addMembers(req.userId, req.valid.params.conversationId, req.valid.body);
    res.status(201).json(result);
  }),
);

// Removing yourself is "leave group".
conversationsRouter.delete(
  '/:conversationId/members/:userId',
  withMember,
  asyncHandler(async (req, res) => {
    const { conversationId, userId } = req.valid.params;
    await groupService.removeMember(req.userId, conversationId, userId);
    res.status(204).end();
  }),
);

conversationsRouter.patch(
  '/:conversationId/members/:userId',
  withMember,
  validate({ body: changeRoleBody }),
  asyncHandler(async (req, res) => {
    const { conversationId, userId } = req.valid.params;
    await groupService.changeMemberRole(req.userId, conversationId, userId, req.valid.body);
    res.status(204).end();
  }),
);

conversationsRouter.post(
  '/:conversationId/transfer-ownership',
  withConversation,
  validate({ body: transferBody }),
  asyncHandler(async (req, res) => {
    await groupService.transferOwnership(req.userId, req.valid.params.conversationId, req.valid.body);
    res.status(204).end();
  }),
);

conversationsRouter.post(
  '/:conversationId/attachments',
  withConversation,
  // Before multer: a non-member's upload is rejected without reading the body.
  asyncHandler(async (req, _res, next) => {
    await requireMembership(req.valid.params.conversationId, req.userId);
    next();
  }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const attachment = await createAttachment(req.userId, req.valid.params.conversationId, req.file);
    res.status(201).json({ attachment });
  }),
);
