import Link from 'next/link';
import { ArrowRight, FileText, MessageCircle } from 'lucide-react';

import { Button } from '@acme/ui';

// App-owned home in the riso-press idiom: a full-bleed dot-grid canvas, an
// oversized Bricolage masthead, a hard-shadowed pink stamp and boxed
// "front-page" index. Feature routes are untouched — this is chrome (ADR 0011).
const desks = [
  {
    n: '01',
    title: 'Grounded answers',
    body: 'Every reply is anchored to passages retrieved from your own library.',
  },
  {
    n: '02',
    title: 'Your corpus',
    body: 'Upload, index and curate the documents the assistant draws from.',
  },
  {
    n: '03',
    title: 'Traceable citations',
    body: 'Follow each claim back to its source — no unaccountable prose.',
  },
];

export function Home() {
  return (
    <div className="riso-grid bg-background min-h-[calc(100vh-3.75rem)]">
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        {/* Masthead rule */}
        <div className="border-border flex items-center justify-between border-b-2 pb-3">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.28em] uppercase">
            Vol. I — No. 1
          </p>
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.28em] uppercase">
            Slim Edition
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-12">
          {/* Lede */}
          <div className="lg:col-span-8">
            <span className="bg-primary text-primary-foreground inline-block px-3 py-1 font-mono text-[11px] tracking-[0.22em] uppercase shadow-[4px_4px_0_0_var(--border)]">
              The RAG Press
            </span>

            <h1 className="text-foreground mt-6 font-serif text-6xl leading-[0.92] font-extrabold tracking-tight text-balance sm:text-8xl">
              Put your
              <br />
              documents
              <span className="text-primary"> to the question.</span>
            </h1>

            <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty">
              Upload a corpus and interrogate it. Retrieval-augmented generation
              grounds every answer in your own sources — cited, traceable and
              dependable.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="border-border rounded-none border-2 font-mono text-xs tracking-[0.18em] uppercase shadow-[4px_4px_0_0_var(--border)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_var(--border)]"
              >
                <Link href="/chat-assistant">
                  <MessageCircle className="size-4" />
                  Open the Chat
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="border-border bg-card rounded-none border-2 font-mono text-xs tracking-[0.18em] uppercase shadow-[4px_4px_0_0_var(--border)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_var(--border)]"
              >
                <Link href="/documents">
                  <FileText className="size-4" />
                  Manage Documents
                </Link>
              </Button>
            </div>
          </div>

          {/* Front-page index */}
          <aside className="lg:col-span-4">
            <div className="border-border bg-card border-2 p-5 shadow-[6px_6px_0_0_var(--border)]">
              <p className="text-muted-foreground border-border border-b-2 pb-2 font-mono text-[11px] tracking-[0.22em] uppercase">
                In this issue
              </p>
              <ol className="mt-4 space-y-5">
                {desks.map((item) => (
                  <li key={item.n} className="flex gap-3">
                    <span className="text-primary font-serif text-lg font-extrabold">
                      {item.n}
                    </span>
                    <span>
                      <span className="text-foreground block font-serif text-base font-bold">
                        {item.title}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-sm leading-snug">
                        {item.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="text-muted-foreground mt-4 text-center font-mono text-[10px] tracking-[0.2em] uppercase">
              Set in Bricolage Grotesque &amp; Archivo
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
