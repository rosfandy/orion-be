import { Router } from 'express';
import { getMe, login, register } from '../controllers/auth.controller.js';
import { googleOneTap, oauthCallback, startOAuth } from '../controllers/oauth.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/google/one-tap', googleOneTap);
authRouter.get('/me', authenticate, getMe);
authRouter.get('/:provider', startOAuth);
authRouter.get('/:provider/callback', oauthCallback);

export default authRouter;
