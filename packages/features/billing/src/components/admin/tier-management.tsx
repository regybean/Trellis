'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';

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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@acme/ui';

import type { Tier } from '../../hooks/use-tier-admin';
import { TIERS, useTierAdmin } from '../../hooks/use-tier-admin';

interface TierManagementProps {
  user: SerializableUser;
}

export function TierManagement({ user }: TierManagementProps) {
  const [tier, setTier] = useState<Tier>('Standard');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const primaryEmail =
    user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
      ?.emailAddress ?? '';

  const {
    setTier: applyTier,
    isPending,
    error,
    isSuccess,
  } = useTierAdmin({ id: user.id, email: primaryEmail });

  const handleApply = () => {
    applyTier(tier, () => setIsDialogOpen(false));
  };

  return (
    <Card className="border-border shadow-xs">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center">
          <CreditCard className="text-accent-foreground mr-2 h-5 w-5" />
          Tier Management
        </CardTitle>
        <div className="text-muted-foreground text-sm">
          Grant or cancel a billing tier directly (local dev / localstripe
          only). Basic cancels any paid subscription.
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tier">Tier</Label>
          <Select
            value={tier}
            onValueChange={(value) => {
              const next = TIERS.find((t) => t === value);
              if (next) setTier(next);
            }}
          >
            <SelectTrigger id="tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button
              className="bg-primary text-on-primary hover:bg-primary/90"
              disabled={!primaryEmail}
            >
              Set to {tier}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set tier to {tier}</DialogTitle>
              <DialogDescription>
                This cancels any existing subscription and, for a paid tier,
                creates an active one on the matching plan. Local dev only.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={isPending}
                className="bg-primary text-on-primary hover:bg-primary/90"
              >
                {isPending ? 'Applying...' : `Set to ${tier}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {error && (
          <div className="text-error-text-red text-sm">
            Error setting tier: {error.message}
          </div>
        )}
        {isSuccess && (
          <div className="text-sm text-green-600">
            Tier successfully updated!
          </div>
        )}
      </CardContent>
    </Card>
  );
}
