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
      <div className="text-text-secondary">Loading rate limit status...</div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="text-text-secondary">Tier</Label>
        <Badge variant="outline" className="text-text">
          {rateLimitStatus.tier}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-text-secondary">Tokens</Label>
        <Badge
          variant={getStatusColor(
            rateLimitStatus.remaining,
            rateLimitStatus.limit,
          )}
          className="text-text"
        >
          {rateLimitStatus.remaining} / {rateLimitStatus.limit}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-text-secondary">Reset Date</Label>
        <div className="text-text text-sm">
          {formatDate(rateLimitStatus.resetAt)}
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-text-secondary">Key Status</Label>
        <div className="flex items-center space-x-2">
          {rateLimitStatus.keyExists ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          )}
          <span className="text-text text-sm">
            {rateLimitStatus.keyExists ? 'Active' : 'Not Found'}
          </span>
        </div>
      </div>
    </div>
  );
}
