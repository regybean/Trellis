'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, RotateCcw, Timer } from 'lucide-react';

import type { SerializableUser } from '@acme/auth';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@acme/ui';

import { useTRPC } from '../../trpc/react';
import { RateLimitStatusDisplay } from './rate-limit-status-display';
import { SubscriptionDetailsDisplay } from './subscription-details-display';

interface RateLimitManagementProps {
  user: SerializableUser;
}

const getStatusColor = (remaining: number, limit: number) => {
  const percentage = (remaining / limit) * 100;
  if (percentage > 50) return 'default';
  if (percentage > 20) return 'secondary';
  return 'destructive';
};

export function RateLimitManagement({ user }: RateLimitManagementProps) {
  const [overrideHours, setOverrideHours] = useState<string>('24');
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isMaxOutDialogOpen, setIsMaxOutDialogOpen] = useState(false);
  const [isOverrideDialogOpen, setIsOverrideDialogOpen] = useState(false);
  const trpc = useTRPC();
  const queryclient = useQueryClient();

  // Queries
  const rateLimitStatus = useQuery(
    trpc.account.getUserRateLimitStatus.queryOptions({ userId: user.id }),
  );

  const subscription = useQuery(
    trpc.account.getUserSubscription.queryOptions({ userId: user.id }),
  );

  const resetRateLimit = useMutation(
    trpc.account.resetUserRateLimit.mutationOptions({
      onSuccess: () => {
        void queryclient.invalidateQueries(
          trpc.account.getUserRateLimitStatus.pathFilter(),
        );
        void queryclient.invalidateQueries(
          trpc.account.getCreditUsage.pathFilter(),
        );
        setIsResetDialogOpen(false);
      },
    }),
  );

  const maxOutRateLimit = useMutation(
    trpc.account.maxOutUserRateLimit.mutationOptions({
      onSuccess: () => {
        void queryclient.invalidateQueries(
          trpc.account.getUserRateLimitStatus.pathFilter(),
        );
        void queryclient.invalidateQueries(
          trpc.account.getCreditUsage.pathFilter(),
        );
        setIsMaxOutDialogOpen(false);
      },
    }),
  );

  const overrideExpiry = useMutation(
    trpc.account.overrideUserRateLimitExpiry.mutationOptions({
      onSuccess: () => {
        void queryclient.invalidateQueries(
          trpc.account.getUserRateLimitStatus.pathFilter(),
        );
        void queryclient.invalidateQueries(
          trpc.account.getCreditUsage.pathFilter(),
        );
        setIsOverrideDialogOpen(false);
      },
    }),
  );

  const handleResetRateLimit = () => {
    resetRateLimit.mutate({ userId: user.id });
  };

  const handleMaxOutRateLimit = () => {
    maxOutRateLimit.mutate({ userId: user.id });
  };

  const handleOverrideExpiry = () => {
    const hours = Number.parseInt(overrideHours, 10);
    if (Number.isNaN(hours) || hours < 0) return;

    const expiryTimestamp = Math.floor(Date.now() / 1000) + hours * 3600;
    overrideExpiry.mutate({ userId: user.id, expiryTimestamp });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('en-gb');
  };

  const primaryEmail =
    user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
      ?.emailAddress ?? 'No email';

  return (
    <Card className="border-border shadow-xs">
      <CardHeader>
        <CardTitle className="text-text flex items-center">
          <Timer className="text-text-accent mr-2 h-5 w-5" />
          Subscription Management
        </CardTitle>
        <div className="text-text-secondary text-sm">
          User: {primaryEmail} (ID: {user.id})
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Rate Limit Status */}
        <div className="space-y-3">
          <h4 className="text-text font-medium">Current Rate Limit Status</h4>
          {rateLimitStatus.data && (
            <RateLimitStatusDisplay
              rateLimitStatus={rateLimitStatus.data}
              isLoading={rateLimitStatus.isLoading}
              getStatusColor={getStatusColor}
              formatDate={formatDate}
            />
          )}
        </div>

        {/* Subscription Details */}
        <div className="space-y-3">
          <h4 className="text-text font-medium">Subscription Details</h4>
          {subscription.data && (
            <SubscriptionDetailsDisplay
              subscriptionData={subscription.data}
              isLoading={subscription.isLoading}
              formatDate={formatDate}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex space-x-4">
          {/* Reset Rate Limit */}
          <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex items-center space-x-2">
                <RotateCcw className="h-4 w-4" />
                <span>Reset Rate Limit</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset Rate Limit</DialogTitle>
                <DialogDescription>
                  This will reset the user&apos;s rate limit tokens back to
                  their tier limit and set the expiry to their normal billing
                  cycle.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setIsResetDialogOpen(false)}
                  disabled={resetRateLimit.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetRateLimit}
                  disabled={resetRateLimit.isPending}
                  className="bg-background-primary text-on-primary hover:bg-background-primary/90"
                >
                  {resetRateLimit.isPending ? 'Resetting...' : 'Reset'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Max Out Rate Limit */}
          <Dialog
            open={isMaxOutDialogOpen}
            onOpenChange={setIsMaxOutDialogOpen}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="flex items-center space-x-2 border-orange-300 text-orange-600 hover:bg-orange-50"
              >
                <AlertTriangle className="h-4 w-4" />
                <span>Max Out Limit</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Max Out Rate Limit</DialogTitle>
                <DialogDescription>
                  This will exhaust the user&apos;s rate limit by setting their
                  remaining tokens to 0. They will not be able to use the
                  service until their rate limit resets.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setIsMaxOutDialogOpen(false)}
                  disabled={maxOutRateLimit.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleMaxOutRateLimit}
                  disabled={maxOutRateLimit.isPending}
                  variant="destructive"
                >
                  {maxOutRateLimit.isPending ? 'Maxing Out...' : 'Max Out'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Override Expiry */}
          <Dialog
            open={isOverrideDialogOpen}
            onOpenChange={setIsOverrideDialogOpen}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="flex items-center space-x-2">
                <Clock className="h-4 w-4" />
                <span>Override Expiry</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Override Rate Limit Expiry</DialogTitle>
                <DialogDescription>
                  This will temporarily override when the user&apos;s rate limit
                  resets.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="overrideHours">Hours from now</Label>
                  <Input
                    id="overrideHours"
                    type="number"
                    value={overrideHours}
                    onChange={(e) => setOverrideHours(e.target.value)}
                    placeholder="24"
                    min="1"
                    max="8760"
                  />
                  <div className="text-text-secondary text-sm">
                    New expiry:{' '}
                    {new Date(
                      // eslint-disable-next-line react-hooks/purity
                      Date.now() +
                        Number.parseInt(overrideHours || '0', 10) * 3_600_000,
                    ).toLocaleString()}
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsOverrideDialogOpen(false)}
                    disabled={overrideExpiry.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleOverrideExpiry}
                    disabled={overrideExpiry.isPending || !overrideHours}
                    className="bg-background-primary text-on-primary hover:bg-background-primary/90"
                  >
                    {overrideExpiry.isPending ? 'Setting...' : 'Set Override'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Error/Success Messages */}
        {resetRateLimit.error && (
          <div className="text-error-text-red text-sm">
            Error resetting rate limit: {resetRateLimit.error.message}
          </div>
        )}
        {maxOutRateLimit.error && (
          <div className="text-error-text-red text-sm">
            Error maxing out rate limit: {maxOutRateLimit.error.message}
          </div>
        )}
        {overrideExpiry.error && (
          <div className="text-error-text-red text-sm">
            Error overriding expiry: {overrideExpiry.error.message}
          </div>
        )}
        {resetRateLimit.isSuccess && (
          <div className="text-sm text-green-600">
            Rate limit successfully reset!
          </div>
        )}
        {maxOutRateLimit.isSuccess && (
          <div className="text-sm text-green-600">
            Rate limit successfully maxed out!
          </div>
        )}
        {overrideExpiry.isSuccess && (
          <div className="text-sm text-green-600">
            Expiry successfully overridden!
          </div>
        )}
      </CardContent>
    </Card>
  );
}
