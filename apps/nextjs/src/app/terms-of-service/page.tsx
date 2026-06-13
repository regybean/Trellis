import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Acme',
  description: 'Learn about the terms and conditions for using Acme.',
};

export default function Page() {
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-3xl font-bold">Terms of Service</h1>
      <p className="text-muted-foreground">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
        tempor incididunt ut labore et dolore magna aliqua. Duis aute irure
        dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat
        nulla pariatur.
      </p>
    </div>
  );
}
