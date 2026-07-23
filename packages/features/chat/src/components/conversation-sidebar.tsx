'use client';

import type { DragEndEvent } from '@dnd-kit/core';
import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  FolderPlus,
  MessageSquarePlus,
  MoreVertical,
  Trash2,
} from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Skeleton,
} from '@acme/ui';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { SelectFolder } from '../api/schemas/folder-schema';
import type { DateBucket } from '../lib/date-buckets';
import { useConversations } from '../hooks/use-conversations';
import {
  bucketOf,
  DATE_BUCKET_LABELS,
  DATE_BUCKET_ORDER,
} from '../lib/date-buckets';

const UNFILED_DROP_ID = 'date-buckets';
const folderDropId = (folderId: string) => `folder:${folderId}`;

interface ConversationSidebarProps {
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
  onNewConversation: () => void;
}

export function ConversationSidebar({
  currentSessionId,
  onSelect,
  onNewConversation,
}: ConversationSidebarProps) {
  const {
    conversations,
    folders,
    isLoading,
    setFolder,
    deleteConversation,
    createFolder,
    deleteFolder,
  } = useConversations();

  const [newFolderName, setNewFolderName] = useState('');

  // Clicks must still select a Conversation, so a small drag threshold
  // distinguishes a click from a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const sessionId = String(event.active.id);
    const over = event.over?.id;
    if (over === undefined) return;
    if (over === UNFILED_DROP_ID) {
      setFolder(sessionId, null);
      return;
    }
    const overId = String(over);
    if (overId.startsWith('folder:')) {
      setFolder(sessionId, overId.slice('folder:'.length));
    }
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder(name);
    setNewFolderName('');
  };

  // A Conversation belongs to a Folder only if its folderId still resolves to a
  // known Folder; a dangling id (deleted Folder) falls through to the buckets.
  const folderIds = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, SelectConversationSummary[]>();
  const unfiled: SelectConversationSummary[] = [];
  for (const c of conversations) {
    if (c.folderId && folderIds.has(c.folderId)) {
      const list = byFolder.get(c.folderId) ?? [];
      list.push(c);
      byFolder.set(c.folderId, list);
    } else {
      unfiled.push(c);
    }
  }

  // `conversations` arrives sorted updatedAt DESC, so per-bucket order is kept.
  const now = new Date();
  const buckets: Record<DateBucket, SelectConversationSummary[]> = {
    today: [],
    week: [],
    older: [],
  };
  for (const c of unfiled) buckets[bucketOf(c.updatedAt, now)].push(c);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="bg-background flex h-full w-72 shrink-0 flex-col border-r">
        <div className="flex flex-col gap-2 p-3">
          <Button
            onClick={onNewConversation}
            className="w-full justify-start gap-2"
            data-testid="new-conversation"
          >
            <MessageSquarePlus className="size-4" />
            New chat
          </Button>
          <div className="flex gap-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFolder();
              }}
              placeholder="New folder"
              aria-label="New folder name"
              data-testid="new-folder-input"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={addFolder}
              aria-label="Add folder"
              data-testid="add-folder"
            >
              <FolderPlus className="size-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex flex-col gap-4 p-3">
            {isLoading ? (
              <ConversationListSkeleton />
            ) : (
              <>
                {folders.map((folder) => (
                  <FolderSection
                    key={folder.id}
                    folder={folder}
                    conversations={byFolder.get(folder.id) ?? []}
                    currentSessionId={currentSessionId}
                    folders={folders}
                    onSelect={onSelect}
                    onDeleteFolder={deleteFolder}
                    onMove={setFolder}
                    onDeleteConversation={deleteConversation}
                  />
                ))}

                <DateBucketsSection
                  buckets={buckets}
                  currentSessionId={currentSessionId}
                  folders={folders}
                  onSelect={onSelect}
                  onMove={setFolder}
                  onDeleteConversation={deleteConversation}
                />
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </DndContext>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Skeleton className="mb-2 h-3 w-16" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-7 w-full" />
        </div>
      </div>
      <div>
        <Skeleton className="mb-2 h-3 w-10" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-7 w-full" />
        </div>
      </div>
    </div>
  );
}

interface FolderSectionProps {
  folder: SelectFolder;
  conversations: SelectConversationSummary[];
  currentSessionId: string;
  folders: SelectFolder[];
  onSelect: (sessionId: string) => void;
  onDeleteFolder: (id: string) => void;
  onMove: (sessionId: string, folderId: string | null) => void;
  onDeleteConversation: (sessionId: string) => void;
}

function FolderSection({
  folder,
  conversations,
  currentSessionId,
  folders,
  onSelect,
  onDeleteFolder,
  onMove,
  onDeleteConversation,
}: FolderSectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId(folder.id) });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md ${isOver ? 'ring-primary ring-2' : ''}`}
    >
      <div className="text-muted-foreground flex items-center justify-between px-1 py-1 text-xs font-semibold uppercase">
        <span className="truncate">{folder.name}</span>
        <button
          type="button"
          onClick={(e) => {
            // Stop the click reaching the enclosing droppable / DndContext so
            // the delete always fires (not swallowed as a drag interaction).
            e.stopPropagation();
            onDeleteFolder(folder.id);
          }}
          aria-label={`Delete folder ${folder.name}`}
          className="hover:text-foreground"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {conversations.map((c) => (
          <ConversationItem
            key={c.sessionId}
            conversation={c}
            active={c.sessionId === currentSessionId}
            folders={folders}
            onSelect={onSelect}
            onMove={onMove}
            onDeleteConversation={onDeleteConversation}
          />
        ))}
        {conversations.length === 0 && (
          <p className="text-muted-foreground px-1 py-2 text-xs">
            Drop chats here
          </p>
        )}
      </div>
    </div>
  );
}

interface DateBucketsSectionProps {
  buckets: Record<DateBucket, SelectConversationSummary[]>;
  currentSessionId: string;
  folders: SelectFolder[];
  onSelect: (sessionId: string) => void;
  onMove: (sessionId: string, folderId: string | null) => void;
  onDeleteConversation: (sessionId: string) => void;
}

function DateBucketsSection({
  buckets,
  currentSessionId,
  folders,
  onSelect,
  onMove,
  onDeleteConversation,
}: DateBucketsSectionProps) {
  // Dropping anywhere in the date area removes a Conversation from its Folder.
  const { setNodeRef, isOver } = useDroppable({ id: UNFILED_DROP_ID });
  // eslint-disable-next-line security/detect-object-injection
  const isEmpty = DATE_BUCKET_ORDER.every((b) => buckets[b].length === 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-4 rounded-md ${isOver ? 'ring-primary ring-2' : ''}`}
    >
      {isEmpty && (
        <p className="text-muted-foreground px-1 py-2 text-xs">
          No conversations yet. Start a new chat.
        </p>
      )}
      {DATE_BUCKET_ORDER.map((bucket) => {
        // eslint-disable-next-line security/detect-object-injection
        const conversations = buckets[bucket];
        // eslint-disable-next-line security/detect-object-injection
        const label = DATE_BUCKET_LABELS[bucket];
        return conversations.length === 0 ? null : (
          <div key={bucket}>
            <p className="text-muted-foreground px-1 py-1 text-xs font-semibold uppercase">
              {label}
            </p>
            <div className="flex flex-col gap-1">
              {conversations.map((c) => (
                <ConversationItem
                  key={c.sessionId}
                  conversation={c}
                  active={c.sessionId === currentSessionId}
                  folders={folders}
                  onSelect={onSelect}
                  onMove={onMove}
                  onDeleteConversation={onDeleteConversation}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ConversationItemProps {
  conversation: SelectConversationSummary;
  active: boolean;
  folders: SelectFolder[];
  onSelect: (sessionId: string) => void;
  onMove: (sessionId: string, folderId: string | null) => void;
  onDeleteConversation: (sessionId: string) => void;
}

function ConversationItem({
  conversation,
  active,
  folders,
  onSelect,
  onMove,
  onDeleteConversation,
}: ConversationItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: conversation.sessionId,
  });

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
        active ? 'bg-accent' : 'hover:bg-accent/50'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        className="flex-1 cursor-pointer truncate text-left"
        onClick={() => onSelect(conversation.sessionId)}
        {...attributes}
        {...listeners}
        data-testid={`conversation-${conversation.sessionId}`}
      >
        {conversation.title}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Conversation actions"
          className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {folders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              disabled={conversation.folderId === folder.id}
              onClick={() => onMove(conversation.sessionId, folder.id)}
            >
              Move to {folder.name}
            </DropdownMenuItem>
          ))}
          {conversation.folderId && (
            <DropdownMenuItem
              onClick={() => onMove(conversation.sessionId, null)}
            >
              Remove from folder
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDeleteConversation(conversation.sessionId)}
          >
            Delete chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
