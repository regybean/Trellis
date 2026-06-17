import Link from 'next/link';

import { Button } from '@acme/ui';

export function Home() {
  return (
    <div className="from-background via-background to-muted/20 min-h-screen bg-gradient-to-b">
      <main className="container mx-auto flex flex-col items-center justify-center gap-6 px-4 py-24 text-center">
        <h1 className="text-foreground text-4xl font-extrabold sm:text-6xl">
          Acme RAG Assistant
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Upload documents to your knowledge base and chat with them using
          retrieval-augmented generation.
        </p>
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/chat-assistant">Open Chat</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/documents">Manage Documents</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
