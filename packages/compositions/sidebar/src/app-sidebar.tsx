'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@acme/ui';

import { NavHeader } from './nav-header';
import { NavHelp } from './nav-help';
import { NavMain } from './nav-main';
import { NavUser } from './nav-user';

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  header?: {
    logo?: string;
    title?: string;
    subtitle?: string;
    width?: number;
    height?: number;
  };
  navMain?: {
    label?: string;
    items: NavItem[];
  };
}

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  items?: {
    title: string;
    url: string;
  }[];
  customContent?: ReactNode;
}

export function AppSidebar({ header, navMain, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavHeader {...header} />
      </SidebarHeader>
      <hr />
      <SidebarContent>
        {navMain && <NavMain items={navMain.items} label={navMain.label} />}
      </SidebarContent>
      <SidebarFooter>
        <NavHelp />
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
