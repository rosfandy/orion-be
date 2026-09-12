import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { searchUsersByEmail } from '../controllers/user.controller.js';

const userRouter = Router();
userRouter.use(authenticate);
userRouter.get('/search/email', searchUsersByEmail);

export default userRouter;
