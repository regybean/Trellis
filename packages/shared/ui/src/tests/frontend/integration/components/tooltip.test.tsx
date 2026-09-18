/**
 * Tooltip — theme-safety contract.
 *
 * `TooltipContent` shipped as `bg-foreground text-background`, which INVERTS
 * with the theme instead of following it: correct-looking in light mode and a
 * white slab under `.dark`. Its `Arrow` made that unfixable from a call site,
 * because the arrow carries its own `bg-foreground` — recolouring the content
 * through `className` left a white diamond behind it.
 *
 * jsdom applies no stylesheet, so there is no computed colour to assert and a
 * screenshot is not available here. What is checkable, and what the fix
 * actually is, is the token contract: both the content and its arrow read the
 * `popover` pair every other overlay in this package uses, and neither reads
 * the inverting pair. A regression to `bg-foreground` is precisely what that
 * catches, and it is the only way this bug has ever appeared.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../index';

function Harness() {
  return (
    <Tooltip>
      <TooltipTrigger>Hover me</TooltipTrigger>
      <TooltipContent>Tip text</TooltipContent>
    </Tooltip>
  );
}

/**
 * The styled element, by its own `data-slot`.
 *
 * Not `getByRole('tooltip')`: Radix puts that role on a visually-hidden
 * announcement node, so the role query finds an unstyled span and every
 * class assertion below would trivially pass. `data-slot` is what this
 * component sets on the node it styles.
 */
const contentNode = async () => {
  const node = await waitFor(() => {
    const found = document.querySelector('[data-slot="tooltip-content"]');
    expect(found).not.toBeNull();
    return found;
  });
  return node as HTMLElement;
};

describe('TooltipContent theming', () => {
  it('themes the content on the popover pair, not the inverting pair', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(screen.getByText('Hover me'));

    const content = await contentNode();

    expect(content.className).toContain('bg-popover');
    expect(content.className).toContain('text-popover-foreground');

    // The inverting pair is the bug. Asserted as absent rather than merely
    // "popover is present", because a className carrying both would still paint
    // whichever Tailwind ordered last.
    expect(content.className).not.toContain('bg-foreground');
    expect(content.className).not.toContain('text-background');
  });

  it('themes the arrow with the content, so no diamond is left behind', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(screen.getByText('Hover me'));
    const content = await contentNode();

    // Radix renders the arrow as an SVG inside the content, and it is baked in
    // by this component rather than passed by a caller — which is exactly why
    // the fix had to land here and not per call site.
    const arrow = content.querySelector('svg');
    expect(arrow).not.toBeNull();
    expect(arrow?.getAttribute('class')).toContain('fill-popover');
    expect(arrow?.getAttribute('class')).not.toContain('fill-foreground');
    expect(arrow?.getAttribute('class')).not.toContain('bg-foreground');
  });
});
