import { Kind, parse, type DocumentNode, type SelectionSetNode } from 'graphql';

export const MAX_DEPTH = 8;

export type GuardResult = { ok: true; document: DocumentNode } | { ok: false; reason: string };

function depthOf(set: SelectionSetNode | undefined, fragments: Map<string, SelectionSetNode>, seen = new Set<string>()): number {
  if (!set) return 0;
  let max = 0;
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      max = Math.max(max, sel.selectionSet ? 1 + depthOf(sel.selectionSet, fragments, seen) : 1);
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(sel.selectionSet, fragments, seen));
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value;
      if (seen.has(name)) continue;
      max = Math.max(max, depthOf(fragments.get(name), fragments, new Set([...seen, name])));
    }
  }
  return max;
}

/** Allows a single read-only query; rejects mutations, subscriptions and overly deep selections. */
export function guardReadOnlyQuery(source: string): GuardResult {
  let document: DocumentNode;
  try {
    document = parse(source);
  } catch (err) {
    return { ok: false, reason: `GraphQL syntax error: ${(err as Error).message}` };
  }

  const operations = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1) return { ok: false, reason: 'Provide exactly one operation.' };
  const op = operations[0];
  if (op.operation !== 'query') {
    return { ok: false, reason: `Only queries are allowed here (got ${op.operation}). Use the write tools for changes.` };
  }
  if (document.definitions.some((d) => d.kind !== Kind.OPERATION_DEFINITION && d.kind !== Kind.FRAGMENT_DEFINITION)) {
    return { ok: false, reason: 'Only operation and fragment definitions are allowed.' };
  }

  const fragments = new Map<string, SelectionSetNode>();
  for (const d of document.definitions) {
    if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d.selectionSet);
  }
  const depth = depthOf(op.selectionSet, fragments);
  if (depth > MAX_DEPTH) return { ok: false, reason: `Query depth ${depth} exceeds the limit of ${MAX_DEPTH}.` };

  return { ok: true, document };
}
