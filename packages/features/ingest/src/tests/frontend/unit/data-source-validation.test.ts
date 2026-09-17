/**
 * data-source-validation — unit.
 *
 * Pure rules, no React and no mocks. The collision check is the one that
 * matters: it has to fold exactly the way rag's unique index folds, or the
 * client waves through a name the server then rejects — or worse, the client
 * absorbs a name into an existing Source the user never picked.
 */
import { describe, expect, it } from 'vitest';

import {
  collisionMessage,
  findNameCollision,
  headroomFor,
} from '../../../lib/data-source-validation';

const sources = [{ name: 'Work notes' }, { name: 'Tax' }];

describe('findNameCollision', () => {
  it('finds a collision ignoring case and surrounding space', () => {
    expect(findNameCollision(sources, '  work NOTES ')).toEqual({
      name: 'Work notes',
    });
  });

  it('returns the EXISTING row so the message quotes the stored name', () => {
    const clash = findNameCollision(sources, 'work notes');
    expect(collisionMessage(clash?.name ?? '')).toBe(
      'You already have a data source called "Work notes".',
    );
  });

  it('passes a distinct name', () => {
    expect(findNameCollision(sources, 'Work notes 2')).toBeUndefined();
  });

  it('treats an all-space name as no collision (the caller rejects it as empty)', () => {
    expect(findNameCollision(sources, '   ')).toBeUndefined();
  });
});

describe('headroomFor', () => {
  it('is undefined while the cap is unknown, so callers omit the hint', () => {
    expect(headroomFor({ documentCount: 3, cap: undefined })).toBeUndefined();
  });

  it('is the remaining slots when the cap is known', () => {
    expect(headroomFor({ documentCount: 47, cap: 50 })).toBe(3);
  });

  it('floors at zero rather than going negative past the cap', () => {
    expect(headroomFor({ documentCount: 51, cap: 50 })).toBe(0);
  });
});
