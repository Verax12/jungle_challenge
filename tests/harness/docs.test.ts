import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkDocs } from '../../scripts/check-docs';
import { cli, documentationFixture, editJson, put, remove } from './helpers';

let root: string;
beforeEach(() => {
  root = documentationFixture();
});
afterEach(() => remove(root));

function requirements(edit: (items: Record<string, unknown>[]) => void): void {
  editJson(root, 'docs/requirements.json', (value) =>
    edit(value.requirements as Record<string, unknown>[]),
  );
}

describe('documentation', () => {
  test('accepts the actual documentation and current requirement states', () => {
    expect(checkDocs(root)).toEqual([]);
    expect(cli(root, 'check-docs.ts').exitCode).toBe(0);
  });

  test('checks local Markdown reference links but ignores fenced examples', () => {
    put(
      root,
      'docs/example.md',
      '# Exemplo\n\n[guia][ref]\n\n[ref]: ../AGENTS.md\n\n```md\n[not a link](absent.md)\n```\n',
    );
    const index = readFileSync(join(root, 'docs/index.md'), 'utf8');
    put(root, 'docs/index.md', `${index}\n- [Exemplo](example.md)\n`);
    expect(checkDocs(root)).toEqual([]);
  });

  test('rejects broken links, fragments, unindexed files and paths outside repository', () => {
    put(
      root,
      'docs/broken.md',
      '# Broken\n\n[missing](missing.md)\n[anchor](../AGENTS.md#missing)\n[outside](../../outside.md)\n',
    );
    const errors = checkDocs(root).join('\n');
    expect(errors).toContain('link local quebrado');
    expect(errors).toContain('âncora inexistente');
    expect(errors).toContain('não referenciado');
  });

  test('accepts valid anchors with accents and repeated headings', () => {
    const guide = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    put(
      root,
      'AGENTS.md',
      `${guide}\n## Validação\n\n## Validação\n\n[primeira](#validação) [segunda](#validação-1)\n`,
    );
    expect(checkDocs(root)).toEqual([]);
  });

  test('rejects duplicate requirement IDs', () => {
    requirements((items) => items.push({ ...items[0]! }));
    expect(checkDocs(root).join('\n')).toContain('ID duplicado');
  });

  test('rejects requirements referencing unknown tasks and README sections', () => {
    requirements((items) => {
      items[0]!.taskId = 'T99';
      items[0]!.readmeSections = ['99'];
    });
    const errors = checkDocs(root).join('\n');
    expect(errors).toContain('tarefa inexistente');
    expect(errors).toContain('seção inexistente');
    expect(errors).toContain('sem requisito rastreado');
  });

  test('detects changes to the archived requirement source', () => {
    put(
      root,
      'docs/challenge.md',
      readFileSync(join(root, 'docs/challenge.md'), 'utf8').replace(
        'Distributed Wagering Processor',
        'Changed processor',
      ),
    );
    expect(checkDocs(root).join('\n')).toContain('diverge de sourceSha256');
  });

  test('allows project README edits while checking its links and using only archived source sections', () => {
    const original = readFileSync(join(root, 'README.md'), 'utf8');
    put(
      root,
      'README.md',
      original + '\n## 99. Comandos do projeto\n\n[guia](docs/index.md)\n',
    );
    expect(checkDocs(root)).toEqual([]);
    put(root, 'README.md', original + '\n[quebrado](missing-guide.md)\n');
    expect(checkDocs(root).join('\n')).toContain('link local quebrado');
  });

  test.each(['README.md', '../outside.md', undefined])(
    'rejects an invalid requirement source path: %s',
    (sourcePath) => {
      editJson(root, 'docs/requirements.json', (value) => {
        value.sourcePath = sourcePath;
      });
      expect(checkDocs(root).join('\n')).toContain('sourcePath deve ser');
    },
  );

  test('verified status requires an actual evidence artifact', () => {
    requirements((items) => {
      items[0]!.status = 'verified';
      items[0]!.evidence = [
        {
          kind: 'integration',
          description: 'Ainda não executado',
          status: 'planned',
        },
      ];
    });
    expect(checkDocs(root).join('\n')).toContain('verificado sem evidência');
    requirements((items) => {
      items[0]!.evidence = [
        {
          kind: 'integration',
          description: 'Executado',
          status: 'verified',
          path: 'missing.txt',
        },
      ];
    });
    expect(checkDocs(root).join('\n')).toContain('exige path');
  });

  test('verified evidence cannot escape the repository', () => {
    requirements((items) => {
      items[0]!.status = 'verified';
      items[0]!.evidence = [
        {
          kind: 'review',
          description: 'Relatório',
          status: 'verified',
          path: '../outside.txt',
        },
      ];
    });
    expect(checkDocs(root).join('\n')).toContain('exige path');
  });

  test('accepts a verified requirement with a recorded evidence file', () => {
    put(root, 'reports/result.txt', 'Fixture: validation evidence.');
    requirements((items) => {
      items[0]!.status = 'verified';
      items[0]!.evidence = [
        {
          kind: 'review',
          description: 'Fixture de evidência',
          status: 'verified',
          path: 'reports/result.txt',
        },
      ];
    });
    expect(checkDocs(root)).toEqual([]);
  });

  test('rejects malformed JSON, requirements and evidence', () => {
    put(root, 'docs/requirements.json', '{bad');
    expect(checkDocs(root).join('\n')).toContain('JSON inválido');
    put(
      root,
      'docs/requirements.json',
      JSON.stringify({ schemaVersion: 1, requirements: [{}] }),
    );
    expect(checkDocs(root).join('\n')).toContain('requisito malformado');
  });

  test('rejects dependency cycles and unknown dependencies', () => {
    editJson(root, 'docs/exec-plans/roadmap.json', (value) => {
      const tasks = value.tasks as Record<string, unknown>[];
      tasks[1]!.dependsOn = ['T02', 'T99'];
    });
    const errors = checkDocs(root).join('\n');
    expect(errors).toContain('ciclo de dependências');
    expect(errors).toContain('tarefa inexistente T99');
  });

  test('rejects malformed execution plans and divergent status', () => {
    put(
      root,
      'docs/exec-plans/active/T99-invalid.md',
      '# Plano inválido\n\n```json\n{"id":"T99","status":"active","requirements":[],"dependsOn":[],"updatedAt":"2026-10-13"}\n```\n',
    );
    const errors = checkDocs(root).join('\n');
    expect(errors).toContain('seção obrigatória ausente');
    expect(errors).toContain('id/status diverge');
  });

  test('requires plans for active/completed tasks and completed dependencies', () => {
    editJson(root, 'docs/exec-plans/roadmap.json', (value) => {
      const tasks = value.tasks as Record<string, unknown>[];
      tasks.push(
        { ...tasks[0]!, id: 'T98', status: 'planned', dependsOn: [] },
        { ...tasks[0]!, id: 'T99', status: 'active', dependsOn: ['T98'] },
      );
    });
    const errors = checkDocs(root).join('\n');
    expect(errors).toContain('T99 exige T98 concluída');
    expect(errors).toContain('sem plano de execução');
  });

  test('CLI exits nonzero for malformed metadata rather than claiming success', () => {
    requirements((items) => items.push({ ...items[0]! }));
    const result = cli(root, 'check-docs.ts');
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('ID duplicado');
  });
});
