import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import { PrismaService } from '../prisma/prisma.service.js';
import { AUTH_TOKEN_TTL_SECONDS } from './auth.constants.js';
import type { AuthUser, JwtPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

const safeUserSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  phone: true,
  department: true,
  position: true,
  role: true,
  status: true,
  telegramChatId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const username = dto.username.trim().toLowerCase();
    const email = this.optionalLowercase(dto.email);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username },
          ...(email ? [{ email }] : []),
        ],
      },
      select: {
        username: true,
        email: true,
      },
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictException('Пользователь с таким логином уже существует');
      }

      throw new ConflictException('Пользователь с такой электронной почтой уже существует');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        username,
        email,
        phone: this.optionalTrim(dto.phone),
        department: this.optionalTrim(dto.department),
        position: this.optionalTrim(dto.position),
        passwordHash,
        role: 'EMPLOYEE',
        status: 'PENDING',
      },
      select: safeUserSelect,
    });

    return {
      message: 'Регистрация завершена. Учётная запись ожидает подтверждения.',
      user,
    };
  }

  async login(dto: LoginDto) {
    const username = dto.username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    if (user.status === 'PENDING') {
      throw new ForbiddenException(
        'Учётная запись ожидает подтверждения администратором',
      );
    }

    if (user.status === 'BLOCKED') {
      throw new ForbiddenException('Учётная запись заблокирована');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: AUTH_TOKEN_TTL_SECONDS,
    });

    return {
      accessToken,
      user: await this.findActiveUserById(user.id),
    };
  }

  async getUserFromToken(token: string): Promise<AuthUser> {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Сессия недействительна или истекла');
    }

    return this.findActiveUserById(payload.sub);
  }

  async findActiveUserById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Учётная запись недоступна');
    }

    return user;
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
    )) as Buffer;

    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, storedHash: string) {
    const [algorithm, salt, hashHex] = storedHash.split('$');

    if (algorithm !== 'scrypt' || !salt || !hashHex) {
      return false;
    }

    const storedKey = Buffer.from(hashHex, 'hex');

    if (storedKey.length !== PASSWORD_KEY_LENGTH) {
      return false;
    }

    const derivedKey = (await scrypt(
      password,
      salt,
      storedKey.length,
    )) as Buffer;

    return timingSafeEqual(storedKey, derivedKey);
  }

  private optionalTrim(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private optionalLowercase(value?: string) {
    const trimmed = value?.trim().toLowerCase();
    return trimmed ? trimmed : null;
  }
}
