import { Label } from '@acme/ui';

export interface SubscriptionData {
  subscription:
    | {
        status: string;
        subscriptionId?: string | null;
        product?: string | null;
        priceId?: string | null;
        currentPeriodStart?: number | null;
        currentPeriodEnd?: number | null;
        cancelAtPeriodEnd?: boolean;
        paymentMethod?: {
          brand: string | null;
          last4: string | null;
        } | null;
      }
    | {
        status: 'none';
      };
}

interface SubscriptionDetailsDisplayProps {
  subscriptionData: SubscriptionData;
  isLoading: boolean;
  formatDate: (timestamp: number) => string;
}

export function SubscriptionDetailsDisplay({
  subscriptionData,
  isLoading,
  formatDate,
}: SubscriptionDetailsDisplayProps) {
  if (isLoading) {
    return (
      <div className="text-muted-foreground">
        Loading subscription details...
      </div>
    );
  }

  return (
    <div className="border-border bg-secondary rounded-lg border p-4">
      {subscriptionData.subscription.status === 'none' ? (
        <div className="text-muted-foreground">No active subscription</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label className="text-muted-foreground">Status</Label>
            <div className="text-foreground">
              {subscriptionData.subscription.status}
            </div>
          </div>
          {'product' in subscriptionData.subscription && (
            <div>
              <Label className="text-muted-foreground">Product</Label>
              <div className="text-foreground">
                {subscriptionData.subscription.product ?? 'N/A'}
              </div>
            </div>
          )}
          {'currentPeriodStart' in subscriptionData.subscription && (
            <div>
              <Label className="text-muted-foreground">Period Start</Label>
              <div className="text-foreground">
                {subscriptionData.subscription.currentPeriodStart
                  ? formatDate(subscriptionData.subscription.currentPeriodStart)
                  : 'N/A'}
              </div>
            </div>
          )}
          {'currentPeriodEnd' in subscriptionData.subscription && (
            <div>
              <Label className="text-muted-foreground">Period End</Label>
              <div className="text-foreground">
                {subscriptionData.subscription.currentPeriodEnd
                  ? formatDate(subscriptionData.subscription.currentPeriodEnd)
                  : 'N/A'}
              </div>
            </div>
          )}
          {'paymentMethod' in subscriptionData.subscription &&
            subscriptionData.subscription.paymentMethod && (
              <>
                <div>
                  <Label className="text-muted-foreground">
                    Payment Method
                  </Label>
                  <div className="text-foreground">
                    {subscriptionData.subscription.paymentMethod.brand} ****
                    {subscriptionData.subscription.paymentMethod.last4}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    Cancel at Period End
                  </Label>
                  <div className="text-foreground">
                    {(() => {
                      if (
                        'cancelAtPeriodEnd' in subscriptionData.subscription
                      ) {
                        return subscriptionData.subscription.cancelAtPeriodEnd
                          ? 'Yes'
                          : 'No';
                      }
                      return 'N/A';
                    })()}
                  </div>
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}
