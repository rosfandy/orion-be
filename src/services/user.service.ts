import { prisma } from '../config/database.js';
import type { SearchUserResult } from '../dtos/workspace.dto.js';

export class UserService {
  async searchUsersByEmail(email: string): Promise<SearchUserResult[]> {
    const normalizedEmail = email.trim().toLowerCase();
    return await prisma.user.findMany({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    }) as unknown as SearchUserResult[];
  }
}
