import type { AuthUserDto } from '../dtos/auth.dto.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUserDto;
    }
  }
}

export {};
