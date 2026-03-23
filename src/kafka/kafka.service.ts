import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, Admin, Partitioners } from 'kafkajs';
import { KafkaTopic } from './kafka.constants';

export interface KafkaMessage<T = any> {
  topic: KafkaTopic;
  payload: T;
  key?: string;
}

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private producer: Producer;
  private consumers: Map<string, Consumer> = new Map();
  private admin: Admin;

  constructor(private config: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'cryptopay-ng',
      brokers: [config.get<string>('KAFKA_BROKER') ?? 'localhost:9092'],
      retry: {
        initialRetryTime: 300,
        retries: 10,
        maxRetryTime: 30000,
        factor: 2,
        multiplier: 1.5,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    this.admin = this.kafka.admin();
  }

  async onModuleInit() {
    await this.connectProducer();
    await this.ensureTopicsExist();
  }

  async onModuleDestroy() {
    await this.disconnectAll();
  }

  // ── CONNECT PRODUCER ──────────────────────────────────────────────────────────
  private async connectProducer() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.error(`Kafka producer connection failed: ${err.message}`);
      // Non-fatal — app still works, events just won't be published
    }
  }

  // ── ENSURE TOPICS EXIST ───────────────────────────────────────────────────────
  private async ensureTopicsExist() {
    try {
      await this.admin.connect();

      const topics = Object.values(KafkaTopic).map((topic) => ({
        topic,
        numPartitions: 3,
        replicationFactor: 1,
      }));

      const created = await this.admin.createTopics({
        topics,
        waitForLeaders: true,
      });

      await this.admin.disconnect();

      if (created) {
        this.logger.log(
          `Kafka topics created: ${Object.values(KafkaTopic).length} topics`,
        );
      } else {
        this.logger.log(
          `Kafka topics ensured: ${Object.values(KafkaTopic).length} topics (already exist)`,
        );
      }
    } catch (err) {
      // Only warn — app still works without topic pre-creation
      // (allowAutoTopicCreation: true on producer handles it anyway)
      this.logger.warn(`Kafka topic creation warning: ${err.message}`);
    }
  }

  // ── PUBLISH MESSAGE ───────────────────────────────────────────────────────────
  async publish<T = any>(
    topic: KafkaTopic,
    payload: T,
    key?: string,
  ): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: key ?? `${topic}-${Date.now()}`,
            value: JSON.stringify({
              ...(payload as any),
              _meta: {
                topic,
                publishedAt: new Date().toISOString(),
                service: 'cryptopay-ng-api',
              },
            }),
          },
        ],
      });

      this.logger.debug(`Kafka published: topic=${topic} key=${key}`);
    } catch (err) {
      // Non-fatal — log but don't crash the main flow
      this.logger.error(
        `Kafka publish failed: topic=${topic} error=${err.message}`,
      );
    }
  }

  // ── SUBSCRIBE TO TOPIC ────────────────────────────────────────────────────────
  async subscribe<T = any>(
    topic: KafkaTopic,
    groupId: string,
    handler: (message: T, rawMessage: any) => Promise<void>,
  ): Promise<void> {
    const consumerKey = `${groupId}-${topic}`;

    if (this.consumers.has(consumerKey)) {
      this.logger.warn(`Consumer already exists for ${consumerKey}`);
      return;
    }

    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      retry: { retries: 10 },
    });

    try {
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ message }) => {
          try {
            const payload = JSON.parse(message.value?.toString() ?? '{}') as T;
            await handler(payload, message);
          } catch (err) {
            this.logger.error(
              `Consumer handler failed: topic=${topic} error=${err.message}`,
            );
          }
        },
      });

      this.consumers.set(consumerKey, consumer);
      this.logger.log(
        `Kafka consumer started: topic=${topic} group=${groupId}`,
      );
    } catch (err) {
      this.logger.error(`Failed to start consumer: ${err.message}`);
    }
  }

  // ── DISCONNECT ALL ────────────────────────────────────────────────────────────
  private async disconnectAll() {
    try {
      await this.producer.disconnect();
      for (const [key, consumer] of this.consumers) {
        await consumer.disconnect();
        this.logger.log(`Kafka consumer disconnected: ${key}`);
      }
      this.logger.log('Kafka producer disconnected');
    } catch (err) {
      this.logger.error(`Kafka disconnect error: ${err.message}`);
    }
  }

  // ── HEALTH CHECK ──────────────────────────────────────────────────────────────
  async isHealthy(): Promise<boolean> {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return true;
    } catch {
      return false;
    }
  }
}
