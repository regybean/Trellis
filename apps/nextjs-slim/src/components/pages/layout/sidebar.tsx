'use client';

import Link from 'next/link';
import { FileText, MessageCircle } from 'lucide-react';

import {
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

// App-owned minimal sidebar — a thin local shell built straight from the
// `@acme/ui` sidebar primitives (shell/chrome is always app-owned, ADR 0011).
// The slim app has no auth/billing, so there's no user chrome — two
// destinations only.
const navItems = [
  { title: 'Chat Assistant', url: '/chat-assistant', icon: MessageCircle },
  { title: 'Documents', url: '/documents', icon: FileText },
];

export function Sidebar() {
  return (
    <SidebarRoot>
      <SidebarHeader className="px-4 py-3 font-semibold">Acme</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Services</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </SidebarRoot>
  );
}
