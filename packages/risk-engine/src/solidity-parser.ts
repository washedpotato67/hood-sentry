import { type Hex, isHex, keccak256, stringToHex } from 'viem';
import type {
  AttributedSourceFile,
  SolidityContractAst,
  SolidityFunction,
  SolidityModifier,
  SoliditySourceAst,
  SolidityStateVariable,
} from './privilege-types.js';

interface Token {
  readonly value: string;
  readonly line: number;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const VISIBILITY = new Set(['public', 'external', 'internal', 'private']);
const FUNCTION_ATTRIBUTES = new Set([
  'public',
  'external',
  'internal',
  'private',
  'view',
  'pure',
  'payable',
  'virtual',
  'override',
  'returns',
]);
const NON_VARIABLE_DECLARATIONS = new Set(['event', 'error', 'using', 'struct', 'enum', 'type']);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Solidity lexical states require explicit branches.
function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  const push = (value: string, tokenLine: number): void => {
    tokens.push({ value, line: tokenLine });
  };
  while (offset < source.length) {
    const char = source[offset];
    const next = source[offset + 1];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      if (char === '\n') line += 1;
      offset += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      offset += 2;
      while (offset < source.length && source[offset] !== '\n') offset += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      offset += 2;
      while (offset < source.length) {
        if (source[offset] === '\n') line += 1;
        if (source[offset] === '*' && source[offset + 1] === '/') {
          offset += 2;
          break;
        }
        offset += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const tokenLine = line;
      let value = quote;
      offset += 1;
      while (offset < source.length) {
        const current = source[offset];
        if (current === undefined) break;
        value += current;
        offset += 1;
        if (current === '\n') line += 1;
        if (current === '\\') {
          const escaped = source[offset];
          if (escaped !== undefined) {
            value += escaped;
            offset += 1;
          }
        } else if (current === quote) {
          break;
        }
      }
      push(value, tokenLine);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const tokenLine = line;
      let value = char;
      offset += 1;
      while (offset < source.length && /[A-Za-z0-9_$]/.test(source[offset] ?? '')) {
        value += source[offset];
        offset += 1;
      }
      push(value, tokenLine);
      continue;
    }
    if (/[0-9]/.test(char)) {
      const tokenLine = line;
      let value = char;
      offset += 1;
      while (offset < source.length && /[A-Za-z0-9_.]/.test(source[offset] ?? '')) {
        value += source[offset];
        offset += 1;
      }
      push(value, tokenLine);
      continue;
    }
    const three = source.slice(offset, offset + 3);
    const two = source.slice(offset, offset + 2);
    if (['>>=', '<<='].includes(three)) {
      push(three, line);
      offset += 3;
    } else if (
      [
        '=>',
        '==',
        '!=',
        '>=',
        '<=',
        '&&',
        '||',
        '++',
        '--',
        '+=',
        '-=',
        '*=',
        '/=',
        '**',
        '<<',
        '>>',
      ].includes(two)
    ) {
      push(two, line);
      offset += 2;
    } else {
      push(char, line);
      offset += 1;
    }
  }
  return tokens;
}

function joinTokens(tokens: readonly Token[]): string {
  return tokens.map((token) => token.value).join(' ');
}

function findMatching(
  tokens: readonly Token[],
  start: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const value = tokens[index]?.value;
    if (value === open) depth += 1;
    if (value === close) depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function splitAtTopLevel(
  tokens: readonly Token[],
  separator: string,
): readonly (readonly Token[])[] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let round = 0;
  let square = 0;
  for (const token of tokens) {
    if (token.value === '(') round += 1;
    if (token.value === ')') round -= 1;
    if (token.value === '[') square += 1;
    if (token.value === ']') square -= 1;
    if (token.value === separator && round === 0 && square === 0) {
      groups.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  groups.push(current);
  return groups;
}

function parameterType(tokens: readonly Token[]): string {
  const storage = new Set(['memory', 'storage', 'calldata', 'indexed']);
  let filtered = tokens.filter((token) => !storage.has(token.value));
  const last = filtered.at(-1);
  if (last !== undefined && IDENTIFIER.test(last.value) && filtered.length > 1) {
    const previous = filtered.at(-2)?.value;
    if (previous !== '.' && previous !== ']') filtered = filtered.slice(0, -1);
  }
  let type = filtered.map((token) => token.value).join('');
  if (type === 'uint') type = 'uint256';
  if (type === 'int') type = 'int256';
  return type;
}

function parameterName(tokens: readonly Token[]): string {
  const storage = new Set(['memory', 'storage', 'calldata', 'indexed']);
  const filtered = tokens.filter((token) => !storage.has(token.value));
  const last = filtered.at(-1);
  if (last === undefined || !IDENTIFIER.test(last.value)) return '';
  if (filtered.length === 1) return '';
  return last.value;
}

function selectorFor(signature: string): Hex {
  const selector = keccak256(stringToHex(signature)).slice(0, 10);
  if (!isHex(selector)) throw new Error(`Failed to derive selector for ${signature}`);
  return selector;
}

function isFunctionKind(value: string): value is SolidityFunction['kind'] {
  return ['function', 'constructor', 'fallback', 'receive'].includes(value);
}

function isFunctionVisibility(value: string): value is NonNullable<SolidityFunction['visibility']> {
  return ['public', 'external', 'internal', 'private'].includes(value);
}

function isContractKind(value: string): value is SolidityContractAst['kind'] {
  return ['contract', 'interface', 'library'].includes(value);
}

function functionModifiers(tokens: readonly Token[]): readonly string[] {
  const modifiers: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !IDENTIFIER.test(token.value)) continue;
    if (FUNCTION_ATTRIBUTES.has(token.value)) continue;
    if (tokens[index - 1]?.value === '.') continue;
    modifiers.push(token.value);
    if (tokens[index + 1]?.value === '(') {
      const end = findMatching(tokens, index + 1, '(', ')');
      if (end !== null) index = end;
    }
  }
  return modifiers;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Function headers contain independent Solidity grammar branches.
function parseFunction(
  contractName: string,
  sourcePath: string,
  tokens: readonly Token[],
  start: number,
): { readonly value: SolidityFunction; readonly end: number } | null {
  const keyword = tokens[start];
  if (keyword === undefined) return null;
  if (!isFunctionKind(keyword.value)) return null;
  const kind = keyword.value;
  let name: string = kind;
  let parametersOpen = start + 1;
  if (kind === 'function') {
    const candidate = tokens[start + 1];
    name = candidate?.value ?? 'fallback';
    parametersOpen = start + 2;
  }
  while (tokens[parametersOpen]?.value !== '(' && parametersOpen < tokens.length) {
    parametersOpen += 1;
  }
  if (tokens[parametersOpen]?.value !== '(') return null;
  const parametersClose = findMatching(tokens, parametersOpen, '(', ')');
  if (parametersClose === null) return null;
  const parameterGroups = splitAtTopLevel(
    tokens.slice(parametersOpen + 1, parametersClose),
    ',',
  ).filter((group) => group.length > 0);
  let headerEnd = parametersClose + 1;
  while (
    headerEnd < tokens.length &&
    tokens[headerEnd]?.value !== '{' &&
    tokens[headerEnd]?.value !== ';'
  ) {
    headerEnd += 1;
  }
  const header = tokens.slice(parametersClose + 1, headerEnd);
  let end = headerEnd;
  let body: readonly Token[] = [];
  if (tokens[headerEnd]?.value === '{') {
    const close = findMatching(tokens, headerEnd, '{', '}');
    if (close === null) return null;
    end = close;
    body = tokens.slice(headerEnd + 1, close);
  }
  const parameterTypes = parameterGroups.map(parameterType);
  const signature = kind === 'function' ? `${name}(${parameterTypes.join(',')})` : `${kind}()`;
  const visibilityToken = header.find((token) => VISIBILITY.has(token.value));
  const mutability = header.some((token) => token.value === 'pure')
    ? 'pure'
    : header.some((token) => token.value === 'view')
      ? 'view'
      : header.some((token) => token.value === 'payable')
        ? 'payable'
        : 'nonpayable';
  return {
    value: {
      contractName,
      name,
      signature,
      selector: kind === 'function' ? selectorFor(signature) : null,
      visibility:
        visibilityToken !== undefined && isFunctionVisibility(visibilityToken.value)
          ? visibilityToken.value
          : null,
      stateMutability: mutability,
      modifiers: functionModifiers(header),
      parameterNames: parameterGroups.map(parameterName).filter((value) => value.length > 0),
      body: joinTokens(body),
      declaration: joinTokens(tokens.slice(start, headerEnd)),
      sourcePath,
      line: keyword.line,
      kind,
    },
    end,
  };
}

function parseModifier(
  contractName: string,
  sourcePath: string,
  tokens: readonly Token[],
  start: number,
): { readonly value: SolidityModifier; readonly end: number } | null {
  const keyword = tokens[start];
  const name = tokens[start + 1];
  if (keyword === undefined || name === undefined) return null;
  let bodyOpen = start + 2;
  while (bodyOpen < tokens.length && tokens[bodyOpen]?.value !== '{') bodyOpen += 1;
  if (tokens[bodyOpen]?.value !== '{') return null;
  const bodyClose = findMatching(tokens, bodyOpen, '{', '}');
  if (bodyClose === null) return null;
  let parameters: readonly string[] = [];
  if (tokens[start + 2]?.value === '(') {
    const close = findMatching(tokens, start + 2, '(', ')');
    if (close !== null) {
      parameters = splitAtTopLevel(tokens.slice(start + 3, close), ',')
        .map(parameterName)
        .filter((value) => value.length > 0);
    }
  }
  return {
    value: {
      contractName,
      name: name.value,
      parameters,
      body: joinTokens(tokens.slice(bodyOpen + 1, bodyClose)),
      sourcePath,
      line: keyword.line,
    },
    end: bodyClose,
  };
}

function parseStateVariable(
  contractName: string,
  sourcePath: string,
  declaration: readonly Token[],
): SolidityStateVariable | null {
  const first = declaration[0];
  if (first === undefined || NON_VARIABLE_DECLARATIONS.has(first.value)) return null;
  if (declaration.some((token) => token.value === '(' && first.value !== 'mapping')) return null;
  const equalsIndex = declaration.findIndex((token) => token.value === '=');
  const beforeValue = equalsIndex === -1 ? declaration : declaration.slice(0, equalsIndex);
  const candidates = beforeValue.filter(
    (token) => IDENTIFIER.test(token.value) && !VISIBILITY.has(token.value),
  );
  const nameToken = candidates.at(-1);
  if (nameToken === undefined) return null;
  const nameIndex = declaration.indexOf(nameToken);
  const typeTokens = declaration
    .slice(0, nameIndex)
    .filter(
      (token) =>
        !VISIBILITY.has(token.value) &&
        token.value !== 'constant' &&
        token.value !== 'immutable' &&
        token.value !== 'override',
    );
  if (typeTokens.length === 0) return null;
  return {
    contractName,
    name: nameToken.value,
    type: typeTokens.map((token) => token.value).join(''),
    visibility: declaration.find((token) => VISIBILITY.has(token.value))?.value ?? null,
    constant: declaration.some((token) => token.value === 'constant'),
    immutable: declaration.some((token) => token.value === 'immutable'),
    declaration: joinTokens(declaration),
    sourcePath,
    line: first.line,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Contract members require isolated recovery paths.
function parseContractBody(
  name: string,
  sourcePath: string,
  body: readonly Token[],
): Pick<SolidityContractAst, 'stateVariables' | 'modifiers' | 'functions'> {
  const stateVariables: SolidityStateVariable[] = [];
  const modifiers: SolidityModifier[] = [];
  const functions: SolidityFunction[] = [];
  let index = 0;
  while (index < body.length) {
    const token = body[index];
    if (token === undefined) break;
    if (['function', 'constructor', 'fallback', 'receive'].includes(token.value)) {
      const parsed = parseFunction(name, sourcePath, body, index);
      if (parsed !== null) {
        functions.push(parsed.value);
        index = parsed.end + 1;
        continue;
      }
    }
    if (token.value === 'modifier') {
      const parsed = parseModifier(name, sourcePath, body, index);
      if (parsed !== null) {
        modifiers.push(parsed.value);
        index = parsed.end + 1;
        continue;
      }
    }
    let end = index;
    let round = 0;
    while (end < body.length) {
      const value = body[end]?.value;
      if (value === '(') round += 1;
      if (value === ')') round -= 1;
      if (value === ';' && round === 0) break;
      if (value === '{' && round === 0) {
        const close = findMatching(body, end, '{', '}');
        end = close ?? end;
        break;
      }
      end += 1;
    }
    const variable = parseStateVariable(name, sourcePath, body.slice(index, end));
    if (variable !== null) stateVariables.push(variable);
    index = end + 1;
  }
  return { stateVariables, modifiers, functions };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: File parsing preserves deterministic error recovery.
function parseFile(file: AttributedSourceFile, warnings: string[]): readonly SolidityContractAst[] {
  const tokens = tokenize(file.source);
  const contracts: SolidityContractAst[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    let abstract = false;
    let kindToken = tokens[index];
    if (kindToken?.value === 'abstract' && tokens[index + 1]?.value === 'contract') {
      abstract = true;
      index += 1;
      kindToken = tokens[index];
    }
    if (kindToken === undefined || !isContractKind(kindToken.value)) {
      continue;
    }
    const name = tokens[index + 1];
    if (name === undefined || !IDENTIFIER.test(name.value)) {
      warnings.push(`${file.path}:${kindToken.line} has a contract declaration without a name`);
      continue;
    }
    let bodyOpen = index + 2;
    while (bodyOpen < tokens.length && tokens[bodyOpen]?.value !== '{') bodyOpen += 1;
    if (tokens[bodyOpen]?.value !== '{') {
      warnings.push(`${file.path}:${kindToken.line} has an unterminated ${kindToken.value}`);
      continue;
    }
    const bodyClose = findMatching(tokens, bodyOpen, '{', '}');
    if (bodyClose === null) {
      warnings.push(`${file.path}:${kindToken.line} has an unbalanced contract body`);
      continue;
    }
    const header = tokens.slice(index + 2, bodyOpen);
    const isIndex = header.findIndex((token) => token.value === 'is');
    const inherits =
      isIndex === -1
        ? []
        : splitAtTopLevel(header.slice(isIndex + 1), ',')
            .map((group) => group.find((token) => IDENTIFIER.test(token.value))?.value)
            .filter((value): value is string => value !== undefined);
    const parsed = parseContractBody(name.value, file.path, tokens.slice(bodyOpen + 1, bodyClose));
    contracts.push({
      name: name.value,
      kind: kindToken.value,
      abstract,
      inherits,
      ...parsed,
      sourcePath: file.path,
    });
    index = bodyClose;
  }
  return contracts;
}

export function parseSoliditySources(files: readonly AttributedSourceFile[]): SoliditySourceAst {
  const warnings: string[] = [];
  const contracts = files.flatMap((file) => parseFile(file, warnings));
  return {
    contracts: contracts.sort((left, right) =>
      left.sourcePath === right.sourcePath
        ? left.name.localeCompare(right.name)
        : left.sourcePath.localeCompare(right.sourcePath),
    ),
    parseWarnings: warnings.sort(),
  };
}
