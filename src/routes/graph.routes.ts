import { Router } from 'express';
import {
  createGraph,
  deleteGraph,
  getGraph,
  getGraphsByLabel,
  getGraphHierarchy,
  updateGraph,
} from '../controllers/graph.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const graphRouter = Router();
graphRouter.use(authenticate);
graphRouter.post('/', createGraph);
graphRouter.get('/label/:label', getGraphsByLabel);
graphRouter.get('/:id/hierarchy', getGraphHierarchy);
graphRouter.get('/:id', getGraph);
graphRouter.patch('/:id', updateGraph);
graphRouter.delete('/:id', deleteGraph);

export default graphRouter;
