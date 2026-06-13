'use client';

import { FileText, MessageCircle, Tag } from 'lucide-react';

import { AppSidebar } from '@acme/sidebar';

export function Sidebar() {
  return (
    <AppSidebar
      header={{ title: 'Acme' }}
      navMain={{
        label: 'Services',
        items: [
          {
            title: 'Chat Assistant',
            url: '/chat-assistant',
            icon: MessageCircle,
          },
          {
            title: 'Documents',
            url: '/admin',
            icon: FileText,
          },
          {
            title: 'Pricing',
            url: '/pricing',
            icon: Tag,
          },
        ],
      }}
    />
  );
}
