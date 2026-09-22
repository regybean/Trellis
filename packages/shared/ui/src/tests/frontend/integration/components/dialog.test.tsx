/**
 * Dialog — the content grid must not be sized by its content.
 *
 * `DialogContent` is a grid, and its implicit column was `auto`, whose minimum
 * comes from the content. One unbreakable string inside — the upload dialog's
 * `truncate`d filenames were the first — widened the track past the dialog's
 * own `max-w`, and every row rode out with it: the filename list escaped the
 * panel by ~200px and the footer's Cancel/Upload buttons by ~215px, measured in
 * headless Chrome at the `sm:max-w-lg` width.
 *
 * jsdom lays nothing out, so there is no geometry to assert here and the real
 * measurement lived in a throwaway browser harness. What is checkable, and what
 * the fix actually is, is the track: an explicit `minmax(0,1fr)` column pins the
 * minimum to zero, which both keeps the track inside the box and gives a
 * descendant's `truncate` something to truncate against. The regression this
 * catches is a re-sync of the upstream shadcn `dialog.tsx`, which ships the
 * `auto` track and is the only way the bug has ever appeared.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../../index';

describe('DialogContent sizing', () => {
  it('pins the content column to a zero minimum', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>Files land in one data source.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const content = document.querySelector('[data-slot="dialog-content"]');

    expect(content).not.toBeNull();
    expect(content?.className).toContain('grid-cols-[minmax(0,1fr)]');
  });
});
