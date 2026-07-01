'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, MessageCircle } from 'lucide-react';

import {
  cn,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  Sidebar as SidebarRoot,
} from '@acme/ui';

// App-owned brutalist sidebar — a thin local shell built straight from the
// `@acme/ui` sidebar primitives (shell/chrome is always app-owned, ADR 0011).
// The slim app has no auth/billing, so there's no user chrome — two
// destinations only. The riso-press identity lives entirely in the classNames
// here plus the token override in styles.css; the primitives are untouched.
const navItems = [
  { title: 'Chat Assistant', url: '/chat-assistant', icon: MessageCircle },
  { title: 'Documents', url: '/documents', icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <SidebarRoot className="border-border border-r-2">
      <SidebarHeader className="border-border riso-grid gap-0 border-b-2 px-4 py-5">
        <Link href="/" className="flex flex-col leading-none">
          <span className="text-foreground font-serif text-3xl font-extrabold tracking-tight">
            ACME
          </span>
          <span className="text-primary mt-1 font-mono text-[10px] font-semibold tracking-[0.3em] uppercase">
            The RAG Press
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-1 pt-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground font-mono text-[10px] tracking-[0.28em] uppercase">
            Desks
          </SidebarGroupLabel>
          <SidebarMenu className="mt-1 gap-1.5">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.url);
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    className={cn(
                      'border-border rounded-none border-2 font-mono text-xs font-semibold tracking-[0.12em] uppercase transition-all',
                      'hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--border)]',
                      active
                        ? 'bg-primary text-primary-foreground hover:bg-primary shadow-[3px_3px_0_0_var(--border)]'
                        : 'bg-card',
                    )}
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </SidebarRoot>
  );
}
