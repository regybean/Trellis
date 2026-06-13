'use client';

import Image from 'next/image';
import Link from 'next/link';

import { SidebarMenu, SidebarMenuItem, useSidebar } from '@acme/ui';

interface NavHeaderProps {
  logo?: string;
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
}

export function NavHeader({ logo, title = '', width, height }: NavHeaderProps) {
  const { state } = useSidebar();
  const smallSize = 28;
  const imgWidth = state === 'expanded' ? (width ?? smallSize) : smallSize;
  const imgHeight = state === 'expanded' ? (height ?? smallSize) : smallSize;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center justify-center px-2 py-1.5">
          {logo && (
            <Link
              href="/"
              className={`inline-flex shrink-0 items-center justify-center rounded-lg ${
                state === 'expanded' ? '' : 'p-1'
              }`}
            >
              <Image
                src={logo}
                alt={title}
                width={imgWidth}
                height={imgHeight}
                className="h-auto w-auto"
              />
            </Link>
          )}
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
