import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  addWorkspaceMember,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspaceMember,
  searchUsersByEmail,
  updateWorkspace,
} from '../controllers/workspace.controller.js';

const workspaceRouter = Router();
workspaceRouter.use(authenticate);
workspaceRouter.get('/', listWorkspaces);
workspaceRouter.post('/', createWorkspace);
workspaceRouter.get('/users/search', searchUsersByEmail);
workspaceRouter.get('/:id', getWorkspace);
workspaceRouter.patch('/:id', updateWorkspace);
workspaceRouter.delete('/:id', deleteWorkspace);
workspaceRouter.post('/:id/members', addWorkspaceMember);
workspaceRouter.delete('/:id/members/:userId', removeWorkspaceMember);

export default workspaceRouter;
