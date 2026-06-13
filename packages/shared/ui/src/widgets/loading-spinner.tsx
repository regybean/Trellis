export const LoadingSpinner = () => {
  return (
    <div
      className="bg-background/60 fixed inset-0 z-50 grid place-items-center backdrop-blur-xs"
      role="status"
      aria-live="polite"
      aria-label="Content is loading"
    >
      <div className="relative h-16 w-16">
        <div className="border-border/30 absolute inset-0 rounded-full border-2" />
        <div
          className="h-full w-full animate-spin rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, hsl(220 90% 60%) 0deg, hsl(260 90% 60%) 120deg, hsl(290 90% 60%) 240deg, hsl(220 90% 60%) 360deg)',
            WebkitMask:
              'radial-gradient(farthest-side, transparent 55%, black 56%)',
            mask: 'radial-gradient(farthest-side, transparent 55%, black 56%)',
          }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="bg-background h-2.5 w-2.5 rounded-full shadow-xs" />
        </div>
      </div>
    </div>
  );
};
