/**
 * Diffing and merging the two sides — including the defect that made every run
 * of `pnpm env:pull` report the same keys as changed forever.
 */
import { describe, expect, it } from 'vitest';

import { diff, merge } from '../../../merge';

describe('diff', () => {
  it('reports keys only the destination holds', () => {
    expect(
      diff({ source: { A: '1' }, destination: { A: '1', LOCAL_ONLY: 'x' } }),
    ).toEqual({
      destinationOnly: ['LOCAL_ONLY'],
      differing: [],
    });
  });

  it('reports a common key whose values differ, with both values', () => {
    expect(
      diff({ source: { A: 'remote' }, destination: { A: 'local' } }).differing,
    ).toEqual([{ key: 'A', source: 'remote', destination: 'local' }]);
  });

  it('does not report a key only the source holds — nothing is at risk', () => {
    expect(
      diff({ source: { A: '1', NEW: '2' }, destination: { A: '1' } }),
    ).toEqual({
      destinationOnly: [],
      differing: [],
    });
  });

  it('reports a key that is empty on both sides as unchanged', () => {
    expect(
      diff({ source: { API_SECRET: '' }, destination: { API_SECRET: '' } })
        .differing,
    ).toEqual([]);
  });

  it('reports an empty value against a filled one as differing', () => {
    expect(
      diff({ source: { K: '' }, destination: { K: 'filled' } }).differing,
    ).toEqual([{ key: 'K', source: '', destination: 'filled' }]);
  });

  it('handles a key name containing a quote as data', () => {
    expect(
      diff({ source: { 'A"B': 'one' }, destination: { 'A"B': 'two' } })
        .differing,
    ).toEqual([{ key: 'A"B', source: 'one', destination: 'two' }]);
  });
});

describe('merge', () => {
  const source = { COMMON: 'from-source', SOURCE_ONLY: 'new' };
  const destination = { COMMON: 'from-destination', DESTINATION_ONLY: 'kept?' };

  it('takes the source and drops the destination-only keys', () => {
    expect(
      merge({ source, destination, keepExtra: false, preferSource: true }),
    ).toEqual({
      COMMON: 'from-source',
      SOURCE_ONLY: 'new',
    });
  });

  it('takes the source and keeps the destination-only keys', () => {
    expect(
      merge({ source, destination, keepExtra: true, preferSource: true }),
    ).toEqual({
      COMMON: 'from-source',
      SOURCE_ONLY: 'new',
      DESTINATION_ONLY: 'kept?',
    });
  });

  it('keeps the destination values and appends only new source keys', () => {
    expect(
      merge({ source, destination, keepExtra: true, preferSource: false }),
    ).toEqual({
      COMMON: 'from-destination',
      DESTINATION_ONLY: 'kept?',
      SOURCE_ONLY: 'new',
    });
  });

  it('keeps the destination whole when its values win, whatever keepExtra says', () => {
    expect(
      merge({ source, destination, keepExtra: false, preferSource: false }),
    ).toEqual(
      merge({ source, destination, keepExtra: true, preferSource: false }),
    );
  });

  it('orders the source first when the source wins, the destination first when it does not', () => {
    expect(
      Object.keys(
        merge({ source, destination, keepExtra: true, preferSource: true }),
      ),
    ).toEqual(['COMMON', 'SOURCE_ONLY', 'DESTINATION_ONLY']);
    expect(
      Object.keys(
        merge({ source, destination, keepExtra: true, preferSource: false }),
      ),
    ).toEqual(['COMMON', 'DESTINATION_ONLY', 'SOURCE_ONLY']);
  });

  it('carries a key name containing a quote through as data', () => {
    expect(
      merge({
        source: { 'A"B': 'v' },
        destination: {},
        keepExtra: false,
        preferSource: true,
      }),
    ).toEqual({ 'A"B': 'v' });
  });
});
