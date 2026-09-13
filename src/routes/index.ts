import { Router } from 'express';
import authRouter from './auth.routes.js';
import collaborationRouter from './collaboration.routes.js';
import documentRouter from './document.routes.js';
import documentSearchRouter from './document-search.routes.js';
import documentVersionRouter from './document-version.routes.js';
import graphRouter from './graph.routes.js';
import healthRouter from './health.routes.js';
import userRouter from './user.routes.js';
import workspaceRouter from './workspace.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/workspaces', workspaceRouter);
router.use('/graphs', graphRouter);
router.use('/users', userRouter);
router.use('/collaboration', collaborationRouter);
router.use('/documents', documentRouter);
router.use('/documents/search', documentSearchRouter);
router.use('/documents', documentVersionRouter);

export default router;
