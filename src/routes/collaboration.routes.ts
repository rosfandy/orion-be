import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorizeCollaboration } from '../controllers/collaboration.controller.js';

const collaborationRouter = Router();
collaborationRouter.use(authenticate);
collaborationRouter.post('/auth', authorizeCollaboration);

export default collaborationRouter;
