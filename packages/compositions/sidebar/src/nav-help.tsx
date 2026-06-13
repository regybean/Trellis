'use client';

import { useRouter } from 'next/navigation';
import { FileText, HelpCircle, Shield } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@acme/ui';

export function NavHelp() {
  const { state } = useSidebar();
  const router = useRouter();
  const isCollapsed = state === 'collapsed';

  const handleNavigation = (path: string) => {
    router.push(path);
  };

  if (isCollapsed) {
    return (
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip="Help">
                  <HelpCircle />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuItem
                  onClick={() => handleNavigation('/terms-of-service')}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Terms of Service
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleNavigation('/privacy-policy')}
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Privacy Policy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Help</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => handleNavigation('/terms-of-service')}
            tooltip="Terms of Service"
            className="cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            <span>Terms of Service</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => handleNavigation('/privacy-policy')}
            tooltip="Privacy Policy"
            className="cursor-pointer"
          >
            <Shield className="h-4 w-4" />
            <span>Privacy Policy</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
