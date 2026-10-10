import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const schema =
      new URL(connectionString).searchParams.get('schema') ?? 'public';

    // Never let test processes silently connect to the working schema.
    if (process.env.NODE_ENV === 'test' && schema !== 'e2e') {
      throw new Error(
        `E2E-тесты должны использовать схему e2e, сейчас: ${schema}`,
      );
    }

    const adapter = new PrismaPg(
      { connectionString },
      { schema },
    );

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}