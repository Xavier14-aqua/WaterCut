import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const canonicalText = (value) => value.replace(/\r\n/g, '\n');

function canonicalNode(value) {
  if (Array.isArray(value)) return value.map(canonicalNode);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            'loc',
            'start',
            'end',
            'extra',
            'leadingComments',
            'trailingComments',
            'innerComments',
            'comments',
          ].includes(key),
      )
      .map(([key, child]) => [key, canonicalNode(child)]),
  );
}

/** SQL values are compared independent of code layout, imports and file names. */
export function sqlFingerprints(text, filename) {
  const ast = parse(text, {
    sourceType: 'module',
    plugins: ['typescript', ...(filename.endsWith('.tsx') ? ['jsx'] : [])],
  });
  const values = [];
  const sql =
    /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|DROP|VACUUM|REPLACE)(?:\s|$)/i;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'StringLiteral' && sql.test(node.value.trim()))
      values.push('text:' + canonicalText(node.value).trim());
    if (
      node.type === 'TemplateLiteral' &&
      sql.test(node.quasis[0].value.cooked.trim())
    ) {
      let value = '';
      node.quasis.forEach((part, index) => {
        value += canonicalText(part.value.cooked);
        if (node.expressions[index])
          value +=
            '${' + JSON.stringify(canonicalNode(node.expressions[index])) + '}';
      });
      values.push('template:' + value.trim());
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast);
  return values.map(hash);
}

export function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
