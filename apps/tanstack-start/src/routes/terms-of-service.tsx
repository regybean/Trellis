import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/terms-of-service')({
  component: TermsOfServiceRoute,
});

function TermsOfServiceRoute() {
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-3xl font-bold">Terms of Service</h1>
      <p className="text-muted-foreground">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
        tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
        veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
        commodo consequat.
      </p>
    </div>
  );
}
