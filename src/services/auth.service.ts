import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import type {
  AuthResponseDto,
  AuthUserDto,
  LoginDto,
  RegisterDto,
} from '../dtos/auth.dto.js';
import { AppError } from '../errors/app-error.js';

const passwordRounds = 12;
const maxPasswordBytes = 72;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function parseRegisterInput(input: unknown): RegisterDto {
  if (!isRecord(input) || typeof input.name !== 'string' || typeof input.email !== 'string' || typeof input.password !== 'string') {
    throw new AppError('Name, email, and password are required', 400);
  }

  validateCredentials(input.email, input.password);

  if (!input.name.trim()) {
    throw new AppError('Name is required', 400);
  }

  return { name: input.name, email: input.email, password: input.password };
}

function parseLoginInput(input: unknown): LoginDto {
  if (!isRecord(input) || typeof input.email !== 'string' || typeof input.password !== 'string') {
    throw new AppError('Email and password are required', 400);
  }

  validateCredentials(input.email, input.password);
  return { email: input.email, password: input.password };
}

function validateCredentials(email: string, password: string): void {
  if (!email.trim() || !email.includes('@')) {
    throw new AppError('A valid email is required', 400);
  }

  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  if (Buffer.byteLength(password, 'utf8') > maxPasswordBytes) {
    throw new AppError('Password must be at most 72 bytes', 400);
  }
}

function toUserDto(user: { id: string; name: string; email: string }): AuthUserDto {
  return { id: user.id, name: user.name, email: user.email };
}

function createToken(user: AuthUserDto): string {
  return jwt.sign({ email: user.email }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '1d',
  });
}

export class AuthService {
  async register(input: unknown): Promise<AuthResponseDto> {
    const credentials = parseRegisterInput(input);

    const email = credentials.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new AppError('Email is already registered', 409);
    }

    let user;

    try {
      user = await prisma.user.create({
        data: {
          name: credentials.name.trim(),
          email,
          passwordHash: await bcrypt.hash(credentials.password, passwordRounds),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('Email is already registered', 409);
      }

      throw error;
    }
    const userDto = toUserDto(user);

    return { token: createToken(userDto), user: userDto };
  }

  async login(input: unknown): Promise<AuthResponseDto> {
    const credentials = parseLoginInput(input);

    const user = await prisma.user.findUnique({
      where: { email: credentials.email.trim().toLowerCase() },
    });
    const passwordMatches = user?.passwordHash
      ? await bcrypt.compare(credentials.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new AppError('Invalid email or password', 401);
    }

    const userDto = toUserDto(user);
    return { token: createToken(userDto), user: userDto };
  }
}
