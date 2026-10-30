import { describe, expect, it } from 'vitest';
import { guardReadOnlyQuery } from './guard';

describe('guardReadOnlyQuery', () => {
  it('allows a plain query', () => {
    expect(guardReadOnlyQuery('{ shop { name } }').ok).toBe(true);
    expect(guardReadOnlyQuery('query Q($n: Int!) { orders(first: $n) { nodes { id } } }').ok).toBe(true);
  });

  it('rejects mutations and subscriptions', () => {
    const m = guardReadOnlyQuery('mutation { productDelete(input: {id: "1"}) { deletedProductId } }');
    expect(m).toMatchObject({ ok: false });
    expect(guardReadOnlyQuery('subscription { x }').ok).toBe(false);
  });

  it('rejects multiple operations so a mutation cannot hide behind a query', () => {
    expect(guardReadOnlyQuery('query A { shop { name } } mutation B { x }').ok).toBe(false);
  });

  it('rejects syntax errors with a reason', () => {
    const r = guardReadOnlyQuery('{ shop { name }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/syntax/i);
  });

  it('enforces max depth, including through fragments', () => {
    const deep = '{ a { b { c { d { e { f { g { h { i } } } } } } } } }';
    expect(guardReadOnlyQuery(deep).ok).toBe(false);
    const viaFragment = 'query { a { ...F } } fragment F on X { b { c { d { e { f { g { h { i } } } } } } } }';
    expect(guardReadOnlyQuery(viaFragment).ok).toBe(false);
    expect(guardReadOnlyQuery('{ orders(first: 5) { nodes { lineItems(first: 5) { nodes { variant { id } } } } } }').ok).toBe(true);
  });

  it('does not loop on recursive fragments', () => {
    expect(guardReadOnlyQuery('query { a { ...F } } fragment F on X { b { ...F } }').ok).toBe(true);
  });
});
