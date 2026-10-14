export interface AppConfig {
  readonly http: { readonly host: string; readonly port: number };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly metrics: { readonly port: number };
  readonly sqs: { readonly endpoint: string; readonly region: string };
}

export class ConfigurationError extends Error {
  constructor(key: string) {
    super(`Configuração inválida: ${key}. Consulte .env.example.`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  function text(key: string, fallback?: string): string {
    const value = env[key] ?? fallback;
    if (!value || !value.trim()) throw new ConfigurationError(key);
    return value;
  }
  function port(key: string, fallback: string): number {
    const value = text(key, fallback);
    if (!/^\d+$/.test(value)) throw new ConfigurationError(key);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535)
      throw new ConfigurationError(key);
    return parsed;
  }
  const endpoint = text('SQS_ENDPOINT', 'http://127.0.0.1:4566');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ConfigurationError('SQS_ENDPOINT');
  }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', 'localstack'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new ConfigurationError('SQS_ENDPOINT');
  }
  return {
    metrics: { port: port('METRICS_PORT', '9464') },
    http: { host: text('HOST', '127.0.0.1'), port: port('PORT', '3000') },
    database: {
      host: text('DB_HOST', '127.0.0.1'),
      port: port('DB_PORT', '15432'),
      name: text('DB_NAME', 'wagering'),
      user: text('DB_USER', 'wagering'),
      password: text('DB_PASSWORD'),
    },
    sqs: { endpoint: url.origin, region: text('AWS_REGION', 'us-east-1') },
  };
}
