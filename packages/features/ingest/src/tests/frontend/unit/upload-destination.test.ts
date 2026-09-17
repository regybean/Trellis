/**
 * upload-destination — unit.
 *
 * The rule the upload dialog renders controls for, driven without a DOM. Three
 * situations over one set of fields, so the cases are: which question is open,
 * what the advisory ceiling is for each answer, and which rejections the schema
 * produces on which field.
 *
 * Field paths matter as much as messages here — a rejection on the wrong path
 * renders beside the wrong control, which is the failure the dialog's inline
 * errors exist to prevent.
 */
import type { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import { headroomFor } from '../../../lib/data-source-validation';
import {
  CREATE_DATA_SOURCE_OPTION,
  uploadDestinationMode,
  uploadDocumentsSchema,
  uploadSlots,
} from '../../../lib/upload-destination';

const WORK = '11111111-1111-4111-8111-111111111111';
const TAX = '22222222-2222-4222-8222-222222222222';

const sources = [
  { id: WORK, name: 'Work notes' },
  { id: TAX, name: 'Tax' },
];

const txt = (name: string) => new File(['content'], name);

// 48 free in Work notes, nothing known about anything else.
const headroom = (dataSourceId: string) =>
  headroomFor({
    documentCount: 2,
    cap: dataSourceId === WORK ? 50 : undefined,
  });

// The caps query still in flight: no Source has a known ceiling.
const capInFlight = () => headroomFor({ documentCount: 0, cap: undefined });

/** The paths and messages a parse rejected on, in issue order. */
const issues = (result: { error?: ZodError }) =>
  (result.error?.issues ?? []).map((issue) => [
    issue.path.join('.'),
    issue.message,
  ]);

describe('uploadDestinationMode', () => {
  it('is inherited when the user is standing in a Source', () => {
    expect(
      uploadDestinationMode({
        inheritsDestination: true,
        hasSources: true,
        dataSourceId: '',
      }),
    ).toBe('inherited');
  });

  it('is pick from the roll-up, where the user has Sources to choose from', () => {
    expect(
      uploadDestinationMode({
        inheritsDestination: false,
        hasSources: true,
        dataSourceId: WORK,
      }),
    ).toBe('pick');
  });

  it('is create when the sentinel option is picked', () => {
    expect(
      uploadDestinationMode({
        inheritsDestination: false,
        hasSources: true,
        dataSourceId: CREATE_DATA_SOURCE_OPTION,
      }),
    ).toBe('create');
  });

  it('is create unprompted when the user has no Sources at all', () => {
    // A new Source is then the only possible destination, and a select holding
    // one create option is a select pretending to be a button.
    expect(
      uploadDestinationMode({
        inheritsDestination: false,
        hasSources: false,
        dataSourceId: '',
      }),
    ).toBe('create');
  });
});

describe('uploadSlots', () => {
  const caps = { headroom, maxDocumentsPerDataSource: 50 };

  it('counts against the inherited Source', () => {
    expect(
      uploadSlots({
        mode: 'inherited',
        destinationId: WORK,
        dataSourceId: '',
        ...caps,
      }),
    ).toBe(48);
  });

  it('counts against the picked Source', () => {
    expect(
      uploadSlots({
        mode: 'pick',
        destinationId: undefined,
        dataSourceId: WORK,
        ...caps,
      }),
    ).toBe(48);
  });

  it('gives a Source created here the whole cap, which is empty by definition', () => {
    expect(
      uploadSlots({
        mode: 'create',
        destinationId: undefined,
        dataSourceId: CREATE_DATA_SOURCE_OPTION,
        ...caps,
      }),
    ).toBe(50);
  });

  it('is undefined with nothing picked yet, so no count is shown', () => {
    expect(
      uploadSlots({
        mode: 'pick',
        destinationId: undefined,
        dataSourceId: '',
        ...caps,
      }),
    ).toBeUndefined();
  });

  it('is undefined while the cap is in flight rather than guessing at one', () => {
    expect(
      uploadSlots({
        mode: 'create',
        destinationId: undefined,
        dataSourceId: CREATE_DATA_SOURCE_OPTION,
        headroom: capInFlight,
        maxDocumentsPerDataSource: undefined,
      }),
    ).toBeUndefined();
  });
});

describe('uploadDocumentsSchema', () => {
  const fromRollUp = uploadDocumentsSchema({
    inheritsDestination: false,
    destinationId: undefined,
    sources,
    headroom,
    maxDocumentsPerDataSource: 50,
  });

  it('demands at least one file', () => {
    expect(
      issues(fromRollUp.safeParse({ files: [], dataSourceId: WORK, name: '' })),
    ).toEqual([['files', 'Choose at least one file to upload.']]);
  });

  it('demands a destination when the user has Sources and picked none', () => {
    expect(
      issues(
        fromRollUp.safeParse({
          files: [txt('a.txt')],
          dataSourceId: '',
          name: '',
        }),
      ),
    ).toEqual([['dataSourceId', 'Choose a data source.']]);
  });

  it('accepts a picked destination', () => {
    expect(
      fromRollUp.safeParse({
        files: [txt('a.txt')],
        dataSourceId: WORK,
        name: '',
      }).success,
    ).toBe(true);
  });

  it('rejects a blank name in create mode, on the name field', () => {
    expect(
      issues(
        fromRollUp.safeParse({
          files: [txt('a.txt')],
          dataSourceId: CREATE_DATA_SOURCE_OPTION,
          name: '  ',
        }),
      ),
    ).toEqual([['name', 'Name your data source.']]);
  });

  it('rejects a colliding name in create mode with the rail’s own message', () => {
    // One rule for both create sites: same folding, same message.
    expect(
      issues(
        fromRollUp.safeParse({
          files: [txt('a.txt')],
          dataSourceId: CREATE_DATA_SOURCE_OPTION,
          name: ' work NOTES ',
        }),
      ),
    ).toEqual([
      ['name', 'You already have a data source called "Work notes".'],
    ]);
  });

  it('refuses a batch past the destination’s headroom, on the file field', () => {
    const tight = uploadDocumentsSchema({
      inheritsDestination: true,
      destinationId: WORK,
      sources,
      headroom: () => 2,
      maxDocumentsPerDataSource: 50,
    });

    expect(
      issues(
        tight.safeParse({
          files: [txt('a.txt'), txt('b.txt'), txt('c.txt')],
          dataSourceId: '',
          name: '',
        }),
      ),
    ).toEqual([['files', 'That data source has room for 2 more documents.']]);
  });

  it('names a full Source as full rather than offering it zero room', () => {
    const full = uploadDocumentsSchema({
      inheritsDestination: true,
      destinationId: WORK,
      sources,
      headroom: () => 0,
      maxDocumentsPerDataSource: 50,
    });

    expect(
      issues(
        full.safeParse({
          files: [txt('a.txt')],
          dataSourceId: '',
          name: '',
        }),
      ),
    ).toEqual([['files', 'That data source is full.']]);
  });

  it('admits any batch while the cap is unknown, leaving presign to refuse it', () => {
    const capless = uploadDocumentsSchema({
      inheritsDestination: true,
      destinationId: WORK,
      sources,
      headroom: capInFlight,
      maxDocumentsPerDataSource: undefined,
    });

    expect(
      capless.safeParse({
        files: [txt('a.txt'), txt('b.txt')],
        dataSourceId: '',
        name: '',
      }).success,
    ).toBe(true);
  });

  it('asks nothing about the destination when it is inherited', () => {
    const inherited = uploadDocumentsSchema({
      inheritsDestination: true,
      destinationId: WORK,
      sources,
      headroom,
      maxDocumentsPerDataSource: 50,
    });

    expect(
      inherited.safeParse({
        files: [txt('a.txt')],
        dataSourceId: '',
        name: '',
      }).success,
    ).toBe(true);
  });
});
