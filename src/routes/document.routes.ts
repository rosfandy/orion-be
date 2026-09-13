import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { getDocument, saveDocument } from '../controllers/document.controller.js';

const documentRouter = Router();
documentRouter.use(authenticate);
documentRouter.get('/:graphId', getDocument);
documentRouter.put('/:graphId', saveDocument);

export default documentRouter;
