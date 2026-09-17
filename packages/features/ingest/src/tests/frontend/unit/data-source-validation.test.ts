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
  dataSourceNameSchema,
  findNameCollision,
  headroomFor,
  headroomMessage,
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

describe('dataSourceNameSchema', () => {
  const schema = dataSourceNameSchema(sources);

  it('rejects a blank name with something to act on', () => {
    expect(schema.safeParse('   ').error?.issues[0]?.message).toBe(
      'Name your data source.',
    );
  });

  it('rejects a collision with the message quoting the name they HAVE', () => {
    // Not the one they typed: the user has to recognise the Source they would
    // otherwise have landed their documents in.
    expect(schema.safeParse(' work NOTES ').error?.issues[0]?.message).toBe(
      'You already have a data source called "Work notes".',
    );
  });

  it('accepts a distinct name', () => {
    expect(schema.safeParse('Work notes 2').success).toBe(true);
  });
});

describe('headroomMessage', () => {
  it('names a full Source as full rather than offering it zero room', () => {
    expect(headroomMessage(0)).toBe('That data source is full.');
  });

  it('is singular at one remaining slot', () => {
    expect(headroomMessage(1)).toBe(
      'That data source has room for 1 more document.',
    );
  });

  it('is plural beyond one', () => {
    expect(headroomMessage(3)).toBe(
      'That data source has room for 3 more documents.',
    );
  });
});
