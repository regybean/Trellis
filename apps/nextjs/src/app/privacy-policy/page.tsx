import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Acme',
  description: 'Learn how we collect, use, and protect your data at Acme.',
};

export default function Page() {
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-3xl font-bold">Privacy Policy</h1>
      <p className="text-muted-foreground">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
        tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
        veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
        commodo consequat.
      </p>
    </div>
  );
}
