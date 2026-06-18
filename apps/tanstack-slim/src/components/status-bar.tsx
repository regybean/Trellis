import { Activity, GitBranch, Terminal } from 'lucide-react';

/**
 * App-owned chrome: a faux developer-console status bar pinned to the bottom of
 * the shell. Purely decorative — it exists to make the TanStack Start app's
 * shell visibly diverge from the Next.js app while every feature slice below it
 * stays identical.
 */
export function StatusBar() {
  return (
    <footer className="border-border bg-sidebar text-muted-foreground flex h-6 shrink-0 items-center gap-4 border-t px-3 font-mono text-[11px] tracking-tight">
      <span className="text-primary flex items-center gap-1">
        <Activity className="h-3 w-3" />
        ready
      </span>
      <span className="flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        tanstack-slim
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Terminal className="h-3 w-3" />
        :3003
      </span>
    </footer>
  );
}
