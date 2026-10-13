import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkArchitecture } from '../../scripts/check-architecture';
import { cli, fixture, put, remove } from './helpers';

let root: string;
beforeEach(() => {
  root = fixture();
  put(
    root,
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
          '@domain/*': ['src/domain/*'],
          '@adapters/*': ['src/adapters/*'],
        },
      },
    }),
  );
});
afterEach(() => remove(root));

describe('architecture', () => {
  test('reports an application that does not exist without asserting backend correctness', () => {
    expect(checkArchitecture(root)).toEqual({ errors: [], count: 0 });
    const result = cli(root, 'check-architecture.ts');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      'backend ainda não implementado',
    );
  });

  test('accepts dependencies toward inner layers and external libraries in adapters', () => {
    put(root, 'src/domain/money.ts', 'export type Amount = string;');
    put(
      root,
      'src/application/ports/store.ts',
      "import type { Amount } from '@domain/money'; export type Store = { value: Amount };",
    );
    put(
      root,
      'src/adapters/store.ts',
      "import type { Store } from '../application/ports/store'; import '@mikro-orm/core'; export type Adapter = Store;",
    );
    put(
      root,
      'src/composition/main.ts',
      "import '../adapters/store'; import '@nestjs/core';",
    );
    expect(checkArchitecture(root)).toEqual({ errors: [], count: 4 });
  });

  test.each([
    "import '../adapters/db';",
    "import '@/adapters/db';",
    "import '@adapters/db';",
    "export * from '../adapters/db';",
    "export { Db } from '@/adapters/db';",
    "import type { Db } from '../adapters/db';",
    "type Db = import('../adapters/db').Db;",
    "const db = import('../adapters/db');",
    "const db = require('../adapters/db');",
    "import db = require('../adapters/db');",
  ])('rejects outward dependency: %s', (source) => {
    put(root, 'src/domain/model.ts', source);
    put(root, 'src/adapters/db.ts', 'export class Db {}');
    expect(
      checkArchitecture(root).errors.some((error) =>
        error.includes('domain não pode importar'),
      ),
    ).toBe(true);
  });

  test.each([
    '@nestjs/common',
    '@mikro-orm/core',
    '@aws-sdk/client-sqs',
    'node:fs',
  ])('rejects external dependency %s in domain', (name) => {
    put(root, 'src/domain/model.ts', `import '${name}';`);
    expect(checkArchitecture(root).errors.join('\n')).toContain(
      'dependência externa',
    );
  });

  test('reserves the exact decimal library exception for domain only', () => {
    put(root, 'src/domain/money.ts', "import Decimal from 'decimal.js';");
    expect(checkArchitecture(root).errors).toEqual([]);
    put(
      root,
      'src/application/service.ts',
      "import Decimal from 'decimal.js';",
    );
    expect(checkArchitecture(root).errors.join('\n')).toContain(
      'proibida em application',
    );
  });

  test('rejects application depending on adapters and adapters depending on composition', () => {
    put(root, 'src/application/service.ts', "import '../adapters/db';");
    put(root, 'src/adapters/db.ts', "import '../composition/main';");
    put(root, 'src/composition/main.ts', 'export {};');
    expect(checkArchitecture(root).errors).toHaveLength(2);
  });

  test('rejects computed dynamic imports and require calls', () => {
    put(
      root,
      'src/adapters/loader.ts',
      'const name = "db"; import(name); require(name);',
    );
    expect(
      checkArchitecture(root).errors.filter((error) =>
        error.includes('não literal'),
      ),
    ).toHaveLength(2);
  });

  test('rejects unknown layers, broken paths, aliases and escaping imports', () => {
    put(root, 'src/main.ts', 'export {};');
    put(root, 'outside.ts', 'export {};');
    put(
      root,
      'src/domain/model.ts',
      "import './missing'; import '@/missing'; import '../../outside';",
    );
    expect(checkArchitecture(root).errors).toHaveLength(4);
  });

  test('detects cycles, including same-layer barrels', () => {
    put(root, 'src/domain/a.ts', "export * from './b';");
    put(root, 'src/domain/b.ts', "export * from './a';");
    expect(checkArchitecture(root).errors.join('\n')).toContain(
      'Ciclo de imports',
    );
  });

  test('a barrel cannot hide an adapter import', () => {
    put(root, 'src/domain/model.ts', "import './barrel';");
    put(root, 'src/domain/barrel.ts', "export * from '@/adapters/db';");
    put(root, 'src/adapters/db.ts', 'export {};');
    expect(checkArchitecture(root).errors.join('\n')).toContain('barrel.ts:1');
  });

  test('CLI fails with actionable file/line diagnostics', () => {
    put(root, 'src/domain/model.ts', "import '@nestjs/common';");
    const result = cli(root, 'check-architecture.ts');
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('src/domain/model.ts:1');
    expect(result.stderr.toString()).toContain('use uma porta');
  });

  test('invalid tsconfig is not silently ignored', () => {
    put(root, 'src/domain/model.ts', 'export {};');
    put(root, 'tsconfig.json', '{ broken');
    expect(checkArchitecture(root).errors.join('\n')).toContain(
      'tsconfig.json inválido',
    );
  });
});
