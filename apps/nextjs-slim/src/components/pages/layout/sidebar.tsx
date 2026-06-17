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

// App-owned minimal sidebar. The slim app drops `@acme/sidebar` (its `AppSidebar`
// hardcodes a Clerk + billing `NavUser`), so this is a thin local shell built
// straight from the `@acme/ui` sidebar primitives. Two destinations, no user
// chrome.
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
