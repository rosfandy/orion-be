import { Router } from 'express';
import authRouter from './auth.routes.js';
import healthRouter from './health.routes.js';
import workspaceRouter from './workspace.routes.js';
import graphRouter from './graph.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/workspaces', workspaceRouter);
router.use('/graphs', graphRouter);

export default router;
