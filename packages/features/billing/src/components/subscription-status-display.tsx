import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Badge, Label } from '@acme/ui';

interface RateLimitStatusDisplayProps {
  rateLimitStatus: {
    tier: string;
    remaining: number;
    limit: number;
    resetAt: number;
    keyExists: boolean;
  };
  isLoading: boolean;
  getStatusColor: (
    remaining: number,
    limit: number,
  ) => 'default' | 'secondary' | 'destructive';
  formatDate: (timestamp: number) => string;
}

export function RateLimitStatusDisplay({
  rateLimitStatus,
  isLoading,
  getStatusColor,
  formatDate,
}: RateLimitStatusDisplayProps) {
  if (isLoading) {
    return (
      <div className="text-muted-foreground">Loading rate limit status...</div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="text-muted-foreground">Tier</Label>
        <Badge variant="outline" className="text-foreground">
          {rateLimitStatus.tier}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-muted-foreground">Tokens</Label>
        <Badge
          variant={getStatusColor(
            rateLimitStatus.remaining,
            rateLimitStatus.limit,
          )}
          className="text-foreground"
        >
          {rateLimitStatus.remaining} / {rateLimitStatus.limit}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-muted-foreground">Reset Date</Label>
        <div className="text-foreground text-sm">
          {formatDate(rateLimitStatus.resetAt)}
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-muted-foreground">Key Status</Label>
        <div className="flex items-center space-x-2">
          {rateLimitStatus.keyExists ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          )}
          <span className="text-foreground text-sm">
            {rateLimitStatus.keyExists ? 'Active' : 'Not Found'}
          </span>
        </div>
      </div>
    </div>
  );
}
