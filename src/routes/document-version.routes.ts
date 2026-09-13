import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  createManualSnapshot,
  deleteVersion,
  getVersion,
  listVersions,
} from '../controllers/document-version.controller.js';

const documentVersionRouter = Router();
documentVersionRouter.use(authenticate);
documentVersionRouter.get('/', listVersions);
documentVersionRouter.get('/:versionId', getVersion);
documentVersionRouter.post('/', createManualSnapshot);
documentVersionRouter.delete('/:versionId', deleteVersion);

export default documentVersionRouter;
