import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { searchDocuments } from '../controllers/document-search.controller.js';

const documentSearchRouter = Router();
documentSearchRouter.use(authenticate);
documentSearchRouter.get('/', searchDocuments);

export default documentSearchRouter;
