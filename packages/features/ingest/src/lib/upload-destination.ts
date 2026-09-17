// lib/upload-destination.ts
//
// Where an upload batch lands, as a rule rather than a sequence of checks in
// the dialog.
//
// A batch takes exactly ONE Data Source and it is mandatory, but the dialog is
// asked for it in three different situations: inherited from where the user is
// standing, picked from the select, or named into the inline create field. Those
// are three rules over one set of fields, so they live here — the dialog reads
// the mode to decide which control to render, and the same mode decides which
// rule the schema applies. Two readers, one definition; the earlier shape had
// the dialog sequencing its own checks and reporting half of them through a
// toast instead of the field that caused them.
//
// Pure and React-free, so the whole rule is unit-testable without a DOM.

import { z } from 'zod';

import {
  dataSourceNameSchema,
  headroomMessage,
} from './data-source-validation';

/**
 * The sentinel `Select` value for `＋ New data source…`. A reserved value rather
 * than a second control, because the create option has to be the LAST item in
 * the same popup — a separate "or create one" button beside the select is the
 * shape that makes users open a second modal to find it.
 */
export const CREATE_DATA_SOURCE_OPTION = '__create__';

/** Which question the dialog still has open about the destination. */
export type UploadDestinationMode = 'inherited' | 'pick' | 'create';

/**
 * The mode, read off the one field that answers the question.
 *
 * Zero Sources is `create` without anyone having asked: a new Source is then
 * the only possible destination, and a select holding one create option is a
 * select pretending to be a button.
 */
export function uploadDestinationMode({
  inheritsDestination,
  hasSources,
  dataSourceId,
}: {
  inheritsDestination: boolean;
  hasSources: boolean;
  dataSourceId: string;
}): UploadDestinationMode {
  if (inheritsDestination) return 'inherited';
  if (!hasSources || dataSourceId === CREATE_DATA_SOURCE_OPTION) {
    return 'create';
  }
  return 'pick';
}

/**
 * The advisory slot count for wherever this batch is headed, or `undefined`
 * when there is nothing to count against yet — no destination chosen, or the
 * cap still in flight.
 *
 * A Source created here is empty by definition, so its ceiling is the whole
 * cap. `undefined` omits the check rather than guessing at a ceiling: presign
 * re-counts and rejects authoritatively either way.
 */
export function uploadSlots({
  mode,
  destinationId,
  dataSourceId,
  headroom,
  maxDocumentsPerDataSource,
}: {
  mode: UploadDestinationMode;
  /** The inherited destination — the Source the user is standing in. */
  destinationId: string | undefined;
  /** The picked (or preselected) Source id, when the select is in play. */
  dataSourceId: string;
  headroom: (dataSourceId: string) => number | undefined;
  maxDocumentsPerDataSource: number | undefined;
}) {
  if (mode === 'create') return maxDocumentsPerDataSource;
  const id = mode === 'inherited' ? destinationId : dataSourceId;
  if (!id) return;
  return headroom(id);
}

/**
 * The upload dialog's form rule: one field shape, and the destination rule the
 * fields themselves select.
 *
 * Only the destination half varies by mode — `inherited` asks nothing (the page
 * answered it by where the user is standing), `pick` wants a Source id, and
 * `create` wants a name that does not collide with one the user already has. So
 * the dialog renders one form rather than three, and the mode is derived from
 * the values being validated rather than passed in, which is what keeps this a
 * plain Standard Schema handed to `validators.onDynamic`.
 *
 * The file count is checked against the destination's advisory headroom here
 * too, BEFORE anything is created: the earlier shape created the Source and
 * only then refused the batch, leaving an empty Source behind.
 */
export function uploadDocumentsSchema({
  inheritsDestination,
  destinationId,
  sources,
  headroom,
  maxDocumentsPerDataSource,
}: {
  inheritsDestination: boolean;
  destinationId: string | undefined;
  sources: readonly { name: string }[];
  headroom: (dataSourceId: string) => number | undefined;
  maxDocumentsPerDataSource: number | undefined;
}) {
  return z
    .object({
      files: z
        .array(z.instanceof(File))
        .min(1, 'Choose at least one file to upload.'),
      dataSourceId: z.string(),
      name: z.string(),
    })
    .superRefine((value, ctx) => {
      const mode = uploadDestinationMode({
        inheritsDestination,
        hasSources: sources.length > 0,
        dataSourceId: value.dataSourceId,
      });

      if (mode === 'pick' && value.dataSourceId.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['dataSourceId'],
          message: 'Choose a data source.',
        });
      }

      if (mode === 'create') {
        // The name rule is the rail's rule — same folding, same message, one
        // definition for both create sites.
        const named = dataSourceNameSchema(sources).safeParse(value.name);
        for (const issue of named.error?.issues ?? []) {
          ctx.addIssue({
            code: 'custom',
            path: ['name'],
            message: issue.message,
          });
        }
      }

      const slots = uploadSlots({
        mode,
        destinationId,
        dataSourceId: value.dataSourceId,
        headroom,
        maxDocumentsPerDataSource,
      });
      if (slots !== undefined && value.files.length > slots) {
        ctx.addIssue({
          code: 'custom',
          path: ['files'],
          message: headroomMessage(slots),
        });
      }
    });
}
