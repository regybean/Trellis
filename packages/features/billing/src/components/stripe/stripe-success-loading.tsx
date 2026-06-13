'use client';
export function StripeSuccessLoading() {
  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 transform animate-ping rounded-full bg-blue-600"></div>
      </div>
      <h2 className="text-xl font-semibold text-gray-800">
        Syncing Your Data...
      </h2>
      <p className="text-center text-gray-600">
        We&apos;re processing your subscription and preparing your account.
        <br />
        This will only take a moment.
      </p>
    </div>
  );
}
