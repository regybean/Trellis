import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';

// Helper to extract textual content from React nodes
function extractString(children: React.ReactNode): string {
  const nodes = React.Children.toArray(children);
  return nodes.map((node) => (typeof node === 'string' ? node : '')).join('');
}
// Props for MarkdownContent component
interface MarkdownContentProps {
  content?: string;
  className?: string;
}
// Custom component to render markdown with proper styling and full feature support
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className,
}) => {
  return (
    <div className={`max-w-none ${className ?? 'text-foreground'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs
          p: ({ ...props }) => (
            <p className="my-2 leading-relaxed text-inherit" {...props} />
          ),

          // Lists
          ul: ({ ...props }) => (
            <ul
              className="my-2 list-outside list-disc space-y-1 pl-5 text-inherit"
              {...props}
            />
          ),
          ol: ({ ...props }) => (
            <ol
              className="my-2 list-outside list-decimal space-y-1 pl-5 text-inherit"
              {...props}
            />
          ),
          li: ({ ...props }) => <li className="text-inherit" {...props} />,

          // Links & emphasis
          a: ({ ...props }) => (
            <a
              className="text-accent-foreground underline underline-offset-2 hover:opacity-80"
              target="_blank"
              rel="noreferrer noopener"
              {...props}
            />
          ),
          strong: ({ ...props }) => (
            <strong className="font-semibold text-inherit" {...props} />
          ),
          em: ({ ...props }) => <em className="italic" {...props} />,

          // Table components with borders
          table: ({ children, ...props }) => (
            <table
              className="my-4 w-full border-collapse border border-gray-300 dark:border-gray-600"
              {...props}
            >
              {children}
            </table>
          ),
          thead: ({ ...props }) => (
            <thead className="bg-gray-100 dark:bg-gray-700" {...props} />
          ),
          tbody: ({ ...props }) => <tbody {...props} />,
          tr: ({ ...props }) => (
            <tr
              className="border-b border-gray-300 dark:border-gray-600"
              {...props}
            />
          ),
          th: ({ ...props }) => (
            <th
              className="border border-gray-300 px-4 py-2 text-left font-bold dark:border-gray-600"
              {...props}
            />
          ),
          td: ({ ...props }) => (
            <td
              className="border border-gray-300 px-4 py-2 dark:border-gray-600"
              {...props}
            />
          ),

          // Heading components with explicit sizing
          h1: ({ ...props }) => (
            <h1 className="mt-6 mb-4 text-3xl font-bold" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="mt-5 mb-3 text-2xl font-bold" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="mt-4 mb-2 text-xl font-bold" {...props} />
          ),
          h4: ({ ...props }) => (
            <h4 className="mt-3 mb-2 text-lg font-bold" {...props} />
          ),
          h5: ({ ...props }) => (
            <h5 className="mt-2 mb-1 text-base font-bold" {...props} />
          ),
          h6: ({ ...props }) => (
            <h6 className="mt-2 mb-1 text-sm font-bold" {...props} />
          ),

          // Horizontal rule with better visibility
          hr: ({ ...props }) => (
            <hr
              className="my-6 border-t-2 border-gray-300 dark:border-gray-600"
              {...props}
            />
          ),

          // Blockquotes
          blockquote: ({ ...props }) => (
            <blockquote
              className="border-ring bg-secondary/40 my-3 border-l-4 px-4 py-2 text-inherit italic"
              {...props}
            />
          ),

          // Inline code with background color
          code: ({
            inline,
            className,
            children,
            ...props
          }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          }) => {
            const match = /language-(\w+)/.exec(className ?? '');
            return inline ? (
              <code
                className="rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                {...props}
              >
                {children}
              </code>
            ) : (
              <SyntaxHighlighter
                language={match ? match[1] : ''}
                PreTag="div"
                className="rounded-sm"
                customStyle={{ margin: '1em 0' }}
                {...props}
              >
                {extractString(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          },

          // Special handling for diff blocks
          pre: ({
            children,
            ...props
          }: React.ComponentPropsWithoutRef<'pre'>) => {
            const contentStr = extractString(children);
            if (contentStr.includes('\n- ') || contentStr.includes('\n+ ')) {
              return (
                <pre
                  {...props}
                  className="diff-block overflow-auto rounded-sm bg-gray-900 p-4 font-mono text-sm text-white"
                >
                  {contentStr.split('\n').map((line, i) => {
                    if (line.startsWith('- ')) {
                      return (
                        <div
                          key={i}
                          className="-mx-2 bg-red-900/30 px-2 text-red-200"
                        >
                          {line}
                        </div>
                      );
                    } else if (line.startsWith('+ ')) {
                      return (
                        <div
                          key={i}
                          className="-mx-2 bg-green-900/30 px-2 text-green-200"
                        >
                          {line}
                        </div>
                      );
                    }
                    return <div key={i}>{line}</div>;
                  })}
                </pre>
              );
            }
            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {content ?? 'No content available.'}
      </ReactMarkdown>
    </div>
  );
};
