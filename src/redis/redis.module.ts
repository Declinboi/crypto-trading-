import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const client = new Redis({
          host:            config.get<string>('REDIS_HOST') ?? 'localhost',
          port:            config.get<number>('REDIS_PORT') ?? 6379,
          password:        config.get<string>('REDIS_PASSWORD') ?? undefined,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 10) return null;
            return Math.min(times * 200, 3000);
          },
          enableReadyCheck:    true,
          lazyConnect:         false,
        });

        client.on('connect',  () => console.log('[Redis] Connected'));
        client.on('error',    (err) => console.error('[Redis] Error:', err.message));
        client.on('ready',    () => console.log('[Redis] Ready'));

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}