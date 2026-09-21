'use client';

import type * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../../src/lib/utils';

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Themed on the `popover` token pair, not `foreground`/`background`.
 *
 * The shadcn default is `bg-foreground text-background`, which inverts with the
 * theme rather than following it — correct-looking in light mode and a white
 * slab under `.dark`. The arrow made that unfixable per call site: it carries
 * its OWN `bg-foreground`, so a caller recolouring the content through
 * `className` left a white diamond behind. Both now read the same tokens every
 * other overlay in this package does (`dropdown-menu`, `select`), so a tooltip
 * is dark-safe wherever it is mounted and no call site restyles it.
 */
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md border px-3 py-1.5 text-xs text-balance shadow-md',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-popover fill-popover z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-r border-b" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
