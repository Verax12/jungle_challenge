import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { filesUnder, inside, relativePath, report } from './lib/files';

const markdown = new MarkdownIt();
const planHeadings = [
  'Objetivo',
  'Requisitos atendidos',
  'Dependências',
  'Limites',
  'Passos',
  'Critérios de aceite',
  'Comandos de validação',
  'Decisões',
  'Resultados e limitações',
  'Próximo passo',
];
const taskStatuses = ['planned', 'active', 'completed', 'blocked'];
const evidenceKinds = [
  'unit',
  'integration',
  'concurrency',
  'review',
  'documentation',
];
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJson(
  text: string,
  label: string,
  errors: string[],
): RecordValue | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (record(value)) return value;
  } catch {
    // The diagnostic below is shared with an invalid root value.
  }
  errors.push(`${label}: JSON inválido; esperado um objeto.`);
}

function headingTexts(text: string): string[] {
  const tokens = markdown.parse(text, {});
  return tokens.flatMap((token, index) =>
    token.type === 'heading_open'
      ? [
          (tokens[index + 1]?.children ?? [])
            .filter((child) => ['text', 'code_inline'].includes(child.type))
            .map((child) => child.content)
            .join(''),
        ]
      : [],
  );
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function checkPlanSections(text: string, label: string): string[] {
  const errors: string[] = [];
  const tokens = markdown.parse(text, {});
  if (
    !tokens.some((token) => token.type === 'heading_open' && token.tag === 'h1')
  )
    errors.push(`${label}: título de plano obrigatório ausente.`);
  for (const heading of planHeadings) {
    const index = tokens.findIndex(
      (token, i) =>
        token.type === 'heading_open' &&
        token.tag === 'h2' &&
        tokens[i + 1]?.content === heading,
    );
    const remaining = index >= 0 ? tokens.slice(index + 3) : [];
    const nextHeading = remaining.findIndex(
      (token) =>
        token.type === 'heading_open' && ['h1', 'h2'].includes(token.tag),
    );
    const body = remaining.slice(
      0,
      nextHeading === -1 ? undefined : nextHeading,
    );
    if (
      index < 0 ||
      !body.some((token) => token.content.trim() && token.type !== 'html_block')
    )
      errors.push(`${label}: seção obrigatória ausente ou vazia "${heading}".`);
  }
  return errors;
}

function anchors(text: string): Set<string> {
  const used = new Set<string>();
  for (const heading of headingTexts(text)) {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    let suffix = 0;
    while (used.has(slug)) slug = `${base}-${++suffix}`;
    used.add(slug);
  }
  return used;
}

function links(text: string): string[] {
  return markdown.parse(text, {}).flatMap((token) =>
    (token.children ?? []).flatMap((child) => {
      const link =
        child.type === 'link_open'
          ? child.attrGet('href')
          : child.type === 'image'
            ? child.attrGet('src')
            : null;
      return link ? [link] : [];
    }),
  );
}

function localTarget(
  root: string,
  file: string,
  link: string,
): { path: string; fragment: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')) return;
  const [url = '', hash = ''] = link.split('#', 2);
  const path = decodeURIComponent(url.split('?')[0] ?? '');
  return {
    path: path
      ? resolve(
          path.startsWith('/') ? root : dirname(file),
          path.replace(/^\//, ''),
        )
      : file,
    fragment: decodeURIComponent(hash),
  };
}

export function checkDocs(root: string): string[] {
  root = resolve(root);
  const errors: string[] = [];
  const required = [
    'README.md',
    'AGENTS.md',
    'ARCHITECTURE.md',
    'docs/index.md',
    'docs/PLANS.md',
    'docs/quality.md',
    'docs/requirements.json',
    'docs/exec-plans/roadmap.json',
  ];
  for (const path of required) {
    if (!existsSync(join(root, path)))
      errors.push(`${path}: arquivo obrigatório ausente.`);
  }
  if (errors.length) return errors;
  const files = [
    join(root, 'README.md'),
    join(root, 'AGENTS.md'),
    join(root, 'ARCHITECTURE.md'),
    ...filesUnder(join(root, 'docs'), '.md'),
  ];
  const indexed = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const link of links(text)) {
      try {
        const target = localTarget(root, file, link);
        if (!target) continue;
        if (!inside(root, target.path) || !existsSync(target.path)) {
          errors.push(
            `${relativePath(root, file)}: link local quebrado ou fora do repositório "${link}".`,
          );
          continue;
        }
        if (file === join(root, 'docs/index.md')) indexed.add(target.path);
        if (
          target.fragment &&
          extname(target.path) === '.md' &&
          statSync(target.path).isFile() &&
          !anchors(readFileSync(target.path, 'utf8')).has(target.fragment)
        ) {
          errors.push(
            `${relativePath(root, file)}: âncora inexistente em "${link}".`,
          );
        }
      } catch {
        errors.push(
          `${relativePath(root, file)}: link local inválido "${link}".`,
        );
      }
    }
    if (
      file.startsWith(join(root, 'docs/exec-plans/active/')) ||
      file.startsWith(join(root, 'docs/exec-plans/completed/'))
    ) {
      errors.push(...checkPlanSections(text, relativePath(root, file)));
    }
  }
  for (const file of filesUnder(join(root, 'docs'), '.md')) {
    if (file !== join(root, 'docs/index.md') && !indexed.has(file))
      errors.push(
        `${relativePath(root, file)}: documento não referenciado diretamente por docs/index.md.`,
      );
  }
  const guideLines = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    .trim()
    .split('\n').length;
  if (guideLines > 100)
    errors.push(
      'AGENTS.md: limite de 100 linhas excedido; mova detalhes para docs/.',
    );

  const roadmap = parseJson(
    readFileSync(join(root, 'docs/exec-plans/roadmap.json'), 'utf8'),
    'roadmap',
    errors,
  );
  const catalog = parseJson(
    readFileSync(join(root, 'docs/requirements.json'), 'utf8'),
    'requirements',
    errors,
  );
  if (!roadmap || !catalog) return errors;
  if (
    roadmap.schemaVersion !== 1 ||
    !Array.isArray(roadmap.tasks) ||
    !roadmap.tasks.length
  ) {
    errors.push(
      'roadmap: schemaVersion deve ser 1 e tasks deve ser uma lista não vazia.',
    );
    return errors;
  }
  if (
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.requirements) ||
    !catalog.requirements.length
  ) {
    errors.push(
      'requirements: schemaVersion deve ser 1 e requirements deve ser uma lista não vazia.',
    );
    return errors;
  }
  const tasks = new Map<string, RecordValue>();
  for (const task of roadmap.tasks) {
    if (
      !record(task) ||
      !nonempty(task.id) ||
      !/^T\d{2}$/.test(task.id) ||
      !nonempty(task.title) ||
      !nonempty(task.scope) ||
      !nonempty(task.status) ||
      !taskStatuses.includes(task.status) ||
      !strings(task.dependsOn) ||
      !strings(task.acceptanceCriteria) ||
      !task.acceptanceCriteria.length ||
      !strings(task.verification) ||
      !task.verification.length
    ) {
      errors.push(
        'roadmap: tarefa malformada; informe id Txx, title, scope, status, dependsOn, acceptanceCriteria e verification.',
      );
      continue;
    }
    if (tasks.has(task.id)) errors.push(`roadmap: ID duplicado ${task.id}.`);
    tasks.set(task.id, task);
  }
  const activeTasks = [...tasks.values()].filter(
    (task) => task.status === 'active',
  );
  if (activeTasks.length > 1)
    errors.push('roadmap: somente uma tarefa pode estar active.');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visitTask(id: string): void {
    if (visiting.has(id)) {
      errors.push(`roadmap: ciclo de dependências envolvendo ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const task = tasks.get(id);
    for (const dependency of (task?.dependsOn as string[]) ?? []) {
      if (!tasks.has(dependency))
        errors.push(
          `roadmap: ${id} depende de tarefa inexistente ${dependency}.`,
        );
      else {
        if (
          (task?.status === 'active' || task?.status === 'completed') &&
          tasks.get(dependency)?.status !== 'completed'
        )
          errors.push(`roadmap: ${id} exige ${dependency} concluída.`);
        visitTask(dependency);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visitTask(id);

  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const sourceHash = createHash('sha256').update(readme).digest('hex');
  if (catalog.sourceSha256 !== sourceHash)
    errors.push(
      'requirements: README.md diverge de sourceSha256; revise o enunciado e a rastreabilidade antes de atualizar o hash.',
    );
  const sections = new Set(
    headingTexts(readme).flatMap((heading) => {
      const match = /^(\d+(?:\.\d+)?)(?:\.|\s)/.exec(heading);
      return match ? [match[1]!] : [];
    }),
  );
  const requirementIds = new Set<string>();
  const covered = new Set<string>();
  for (const requirement of catalog.requirements) {
    if (
      !record(requirement) ||
      !nonempty(requirement.id) ||
      !/^REQ-[A-Z0-9-]+$/.test(requirement.id) ||
      !nonempty(requirement.summary) ||
      !strings(requirement.readmeSections) ||
      !requirement.readmeSections.length ||
      !nonempty(requirement.taskId) ||
      !['planned', 'implemented', 'verified'].includes(
        String(requirement.status),
      ) ||
      !Array.isArray(requirement.evidence) ||
      !requirement.evidence.length
    ) {
      errors.push(
        'requirements: requisito malformado; informe id REQ-*, summary, readmeSections, taskId, status e evidence.',
      );
      continue;
    }
    const id = requirement.id;
    if (requirementIds.has(id))
      errors.push(`requirements: ID duplicado ${id}.`);
    requirementIds.add(id);
    if (!tasks.has(requirement.taskId))
      errors.push(`${id}: tarefa inexistente ${requirement.taskId}.`);
    for (const section of requirement.readmeSections) {
      if (!sections.has(section))
        errors.push(`${id}: seção inexistente no README: ${section}.`);
      covered.add(section);
    }
    let verified = false;
    for (const evidence of requirement.evidence) {
      if (
        !record(evidence) ||
        !evidenceKinds.includes(String(evidence.kind)) ||
        !nonempty(evidence.description) ||
        !['planned', 'verified'].includes(String(evidence.status))
      ) {
        errors.push(
          `${id}: evidência malformada; informe kind, description e status.`,
        );
        continue;
      }
      if (evidence.status === 'verified') {
        const path =
          typeof evidence.path === 'string' ? resolve(root, evidence.path) : '';
        if (
          !path ||
          !inside(root, path) ||
          !existsSync(path) ||
          !statSync(path).isFile()
        )
          errors.push(
            `${id}: evidência verificada exige path para arquivo existente no repositório.`,
          );
        else verified = true;
      }
    }
    if (requirement.status === 'verified' && !verified)
      errors.push(`${id}: requisito verificado sem evidência verificável.`);
    if (requirement.status === 'planned' && verified)
      errors.push(`${id}: evidência verificada contradiz o estado planned.`);
  }
  for (const section of sections) {
    if (!covered.has(section))
      errors.push(
        `requirements: seção ${section} do README sem requisito rastreado.`,
      );
  }

  const plansSeen = new Set<string>();
  for (const file of files.filter((path) =>
    /[/\\]exec-plans[/\\](active|completed)[/\\]/.test(path),
  )) {
    const text = readFileSync(file, 'utf8');
    const metadata = markdown
      .parse(text, {})
      .find((token) => token.type === 'fence' && token.info === 'json');
    const label = relativePath(root, file);
    const plan = metadata
      ? parseJson(metadata.content, label, errors)
      : undefined;
    if (
      !plan ||
      !nonempty(plan.id) ||
      !nonempty(plan.status) ||
      !taskStatuses.includes(plan.status) ||
      !strings(plan.requirements) ||
      !strings(plan.dependsOn) ||
      !validDate(plan.updatedAt)
    ) {
      errors.push(
        `${label}: metadados JSON obrigatórios inválidos; consulte docs/PLANS.md.`,
      );
      continue;
    }
    if (plansSeen.has(plan.id))
      errors.push(`${label}: plano duplicado para ${plan.id}.`);
    plansSeen.add(plan.id);
    const task = tasks.get(plan.id);
    if (!task || task.status !== plan.status)
      errors.push(`${label}: id/status diverge do roadmap.`);
    if (
      task &&
      JSON.stringify(task.dependsOn) !== JSON.stringify(plan.dependsOn)
    )
      errors.push(`${label}: dependências divergem do roadmap.`);
    if (label.includes('/completed/') !== (plan.status === 'completed'))
      errors.push(
        `${label}: diretório não corresponde ao estado ${plan.status}.`,
      );
    for (const id of plan.requirements)
      if (!requirementIds.has(id))
        errors.push(`${label}: requisito inexistente ${id}.`);
  }
  for (const [id, task] of tasks) {
    if (task.status !== 'planned' && !plansSeen.has(id))
      errors.push(
        `${id}: tarefa ${String(task.status)} sem plano de execução.`,
      );
  }
  return errors;
}

if (import.meta.main) {
  process.exitCode = report(
    'docs',
    checkDocs(process.cwd()),
    'Links, planos e rastreabilidade consistentes; verificação documental não comprova comportamento do backend.',
  );
}
