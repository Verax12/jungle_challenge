import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { filesUnder, inside, relativePath, report } from './lib/files';

type Layer = 'domain' | 'application' | 'adapters' | 'composition';
const allowed: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  adapters: ['domain', 'application', 'adapters'],
  composition: ['domain', 'application', 'adapters', 'composition'],
};

function layerOf(root: string, path: string): Layer | undefined {
  const first = relativePath(join(root, 'src'), path).split('/')[0];
  return first && Object.hasOwn(allowed, first) ? (first as Layer) : undefined;
}

export function checkArchitecture(root: string): {
  errors: string[];
  count: number;
} {
  root = resolve(root);
  const errors: string[] = [];
  const sourceRoot = join(root, 'src');
  if (!existsSync(sourceRoot)) return { errors, count: 0 };
  const files = filesUnder(sourceRoot).filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file),
  );
  const configFile = ts.readConfigFile(
    join(root, 'tsconfig.json'),
    ts.sys.readFile,
  );
  if (configFile.error) {
    return {
      errors: [
        'tsconfig.json inválido ou ausente; configure a resolução de imports.',
      ],
      count: files.length,
    };
  }
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const configErrors = config.errors.filter((error) => error.code !== 18003);
  if (configErrors.length) {
    errors.push(
      ...configErrors.map((error) =>
        ts.flattenDiagnosticMessageText(error.messageText, '\n'),
      ),
    );
    return { errors, count: files.length };
  }
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const layer = layerOf(root, file);
    const local = relativePath(root, file);
    if (!layer) {
      errors.push(
        `${local}: camada desconhecida; use src/{domain,application,adapters,composition}.`,
      );
      continue;
    }
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    graph.set(file, dependencies);

    function inspect(module: ts.Node): void {
      const line =
        source.getLineAndCharacterOfPosition(module.getStart(source)).line + 1;
      const location = `${local}:${line}`;
      if (!ts.isStringLiteralLike(module)) {
        errors.push(
          `${location}: import/require dinâmico não literal impede análise; use um módulo literal.`,
        );
        return;
      }
      const name = module.text;
      const resolved = ts.resolveModuleName(
        name,
        file,
        config.options,
        ts.sys,
      ).resolvedModule;
      const target = resolved && resolve(resolved.resolvedFileName);
      const pathAlias = Object.keys(config.options.paths ?? {}).some(
        (pattern) => {
          const star = pattern.indexOf('*');
          return star === -1
            ? pattern === name
            : name.startsWith(pattern.slice(0, star)) &&
                name.endsWith(pattern.slice(star + 1));
        },
      );
      const localImport =
        name.startsWith('.') ||
        name.startsWith('/') ||
        pathAlias ||
        name.startsWith('@/');
      if (target && inside(sourceRoot, target)) {
        const targetLayer = layerOf(root, target);
        if (!targetLayer || !allowed[layer!].includes(targetLayer)) {
          errors.push(
            `${location}: ${layer} não pode importar ${relativePath(root, target)}; dependa de portas das camadas internas.`,
          );
        }
        dependencies.push(target);
      } else if (
        localImport ||
        (target &&
          inside(root, target) &&
          !relativePath(root, target).startsWith('node_modules/'))
      ) {
        errors.push(
          `${location}: import local "${name}" não resolve para uma camada de src; corrija o caminho ou alias.`,
        );
      } else if (layer === 'application' || layer === 'domain') {
        errors.push(
          `${location}: dependência externa "${name}" proibida em ${layer}; use uma porta e implemente-a em adapters.`,
        );
      }
    }

    function visit(node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        inspect(node.moduleSpecifier);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression
      ) {
        inspect(node.moduleReference.expression);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument)
      ) {
        inspect(node.argument.literal);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (argument) inspect(argument);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const trail: string[] = [];
  function walk(file: string): void {
    if (visiting.has(file)) {
      const cycle = [...trail.slice(trail.indexOf(file)), file].map((path) =>
        relativePath(root, path),
      );
      errors.push(
        `Ciclo de imports: ${cycle.join(' → ')}; extraia o contrato para uma camada interna.`,
      );
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    trail.push(file);
    for (const dependency of graph.get(file) ?? []) walk(dependency);
    trail.pop();
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) walk(file);
  return { errors, count: files.length };
}

if (import.meta.main) {
  const root = process.cwd();
  const { errors, count } = checkArchitecture(root);
  process.exitCode = report(
    'architecture',
    errors,
    count
      ? `${count} arquivo(s) verificado(s).`
      : 'Nenhum código de aplicação em src; backend ainda não implementado.',
  );
}
