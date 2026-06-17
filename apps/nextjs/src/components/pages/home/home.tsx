import Link from 'next/link';

import { Button } from '@acme/ui';

export function Home() {
  return (
    <div className="bg-background">
      {/* Lede — asymmetric editorial hero */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <p className="text-muted-foreground mb-6 font-mono text-[11px] tracking-[0.28em] uppercase">
          Vol. I &mdash; No. 1 &middot; The Knowledge Desk
        </p>

        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <h1 className="text-foreground font-serif text-5xl leading-[0.95] font-semibold tracking-tight text-balance sm:text-7xl">
              Read your documents,
              <span className="text-primary italic"> answered.</span>
            </h1>

            <p className="text-muted-foreground mt-6 max-w-xl font-serif text-xl leading-relaxed text-pretty">
              Upload a corpus and put it to the question. Retrieval-augmented
              generation grounds every answer in your own sources &mdash; cited,
              traceable and dependable.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                asChild
                className="rounded-none font-sans text-xs tracking-[0.18em] uppercase"
              >
                <Link href="/chat-assistant">Open the Chat</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="rounded-none font-sans text-xs tracking-[0.18em] uppercase"
              >
                <Link href="/admin">Manage Documents</Link>
              </Button>
            </div>
          </div>

          {/* Marginalia column */}
          <aside className="border-border lg:col-span-4 lg:border-l lg:pl-8">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.22em] uppercase">
              In this issue
            </p>
            <ol className="mt-4 space-y-4">
              {[
                {
                  n: '01',
                  title: 'Grounded answers',
                  body: 'Every response is anchored to retrieved passages from your own library.',
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
              ].map((item) => (
                <li key={item.n} className="flex gap-3">
                  <span className="text-primary font-mono text-xs">
                    {item.n}
                  </span>
                  <span>
                    <span className="text-foreground block font-serif text-base font-medium">
                      {item.title}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      {item.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>

      {/* Standfirst rule + pull quote */}
      <section className="border-border border-y">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <blockquote className="text-foreground font-serif text-2xl leading-snug text-balance italic sm:text-3xl">
            &ldquo;A library that talks back &mdash; precise, sourced, and
            entirely your own.&rdquo;
          </blockquote>
        </div>
      </section>
    </div>
  );
}
