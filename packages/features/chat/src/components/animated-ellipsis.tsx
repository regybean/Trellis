export default function AnimatedEllipsis() {
  return (
    <span className="inline-flex w-32 items-center justify-center gap-3 align-middle">
      <span
        className="animate-bounce-dot bg-foreground h-3 w-3 rounded-full"
        style={{ animationDelay: '0s' }}
      />
      <span
        className="animate-bounce-dot bg-foreground h-3 w-3 rounded-full"
        style={{ animationDelay: '0.2s' }}
      />
      <span
        className="animate-bounce-dot bg-foreground h-3 w-3 rounded-full"
        style={{ animationDelay: '0.4s' }}
      />
    </span>
  );
}
