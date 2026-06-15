import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Database, MessageSquare } from 'lucide-react';

import { Button } from '@acme/ui';

export const Route = createFileRoute('/')({
  component: HomeRoute,
});

// App-owned home — same product, a denser/darker "console landing" framing than
// the Next.js app's centered hero.
function HomeRoute() {
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-primary font-mono text-xs tracking-widest uppercase">
          retrieval-augmented generation
        </p>
        <h1 className="text-foreground text-4xl font-bold tracking-tight sm:text-5xl">
          Acme RAG Console
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Upload documents to your knowledge base and chat with them. Same
          feature slices as the Next.js app, a different shell.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 font-mono">
        <Button asChild>
          <Link to="/chat-assistant">
            <MessageSquare className="h-4 w-4" />
            open chat
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/admin">
            <Database className="h-4 w-4" />
            manage documents
          </Link>
        </Button>
      </div>
    </div>
  );
}
