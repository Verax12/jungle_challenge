import { describe, expect, test } from 'bun:test';
import {
  ConfigurationError,
  loadConfig,
} from '../../src/adapters/config/environment.js';

const env = { DB_PASSWORD: 'public-local-test-value' };

describe('environment configuration', () => {
  test('loads local defaults with an explicit database password', () => {
    const config = loadConfig(env);
    expect(config.http).toEqual({ host: '127.0.0.1', port: 3000 });
    expect(config.database.port).toBe(15432);
    expect(config.sqs.endpoint).toBe('http://127.0.0.1:4566');
  });

  test.each(['0', '-1', '65536', '3000.5', '3e3', '', '3000x'])(
    'rejects invalid ports: %s',
    (port) => {
      expect(() => loadConfig({ ...env, PORT: port })).toThrow(
        ConfigurationError,
      );
      expect(() => loadConfig({ ...env, METRICS_PORT: port })).toThrow(
        ConfigurationError,
      );
      expect(() => loadConfig({ ...env, DB_PORT: port })).toThrow(
        ConfigurationError,
      );
    },
  );

  test('accepts Docker addresses and explicit port boundaries', () => {
    const config = loadConfig({
      ...env,
      HOST: '0.0.0.0',
      PORT: '65535',
      DB_PORT: '1',
      DB_HOST: 'postgres',
      SQS_ENDPOINT: 'http://localstack:4566/',
    });
    expect(config.http.port).toBe(65535);
    expect(config.database.host).toBe('postgres');
    expect(config.sqs.endpoint).toBe('http://localstack:4566');
  });

  test.each([
    'not-url',
    'https://sqs.us-east-1.amazonaws.com',
    'http://user:password@localhost:4566',
    'http://localhost:4566?token=value',
    'http://localhost:4566/path',
    'http://localhost:4566#fragment',
  ])('rejects non-local or malformed SQS endpoint: %s', (endpoint) => {
    expect(() => loadConfig({ ...env, SQS_ENDPOINT: endpoint })).toThrow(
      'SQS_ENDPOINT',
    );
  });

  test('rejects missing and blank password without printing the supplied configuration', () => {
    expect(() => loadConfig({})).toThrow('DB_PASSWORD');
    expect(() => loadConfig({ DB_PASSWORD: '   ' })).toThrow('DB_PASSWORD');
    try {
      loadConfig({ ...env, SQS_ENDPOINT: 'private-sensitive-value' });
    } catch (error) {
      expect((error as Error).message).not.toContain('private-sensitive-value');
      expect((error as Error).message).not.toContain(env.DB_PASSWORD);
    }
  });
});
