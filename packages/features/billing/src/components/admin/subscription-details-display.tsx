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
      <div className="text-text-secondary">Loading subscription details...</div>
    );
  }

  return (
    <div className="border-border bg-background-secondary rounded-lg border p-4">
      {subscriptionData.subscription.status === 'none' ? (
        <div className="text-text-secondary">No active subscription</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label className="text-text-secondary">Status</Label>
            <div className="text-text">
              {subscriptionData.subscription.status}
            </div>
          </div>
          {'product' in subscriptionData.subscription && (
            <div>
              <Label className="text-text-secondary">Product</Label>
              <div className="text-text">
                {subscriptionData.subscription.product ?? 'N/A'}
              </div>
            </div>
          )}
          {'currentPeriodStart' in subscriptionData.subscription && (
            <div>
              <Label className="text-text-secondary">Period Start</Label>
              <div className="text-text">
                {subscriptionData.subscription.currentPeriodStart
                  ? formatDate(subscriptionData.subscription.currentPeriodStart)
                  : 'N/A'}
              </div>
            </div>
          )}
          {'currentPeriodEnd' in subscriptionData.subscription && (
            <div>
              <Label className="text-text-secondary">Period End</Label>
              <div className="text-text">
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
                  <Label className="text-text-secondary">Payment Method</Label>
                  <div className="text-text">
                    {subscriptionData.subscription.paymentMethod.brand} ****
                    {subscriptionData.subscription.paymentMethod.last4}
                  </div>
                </div>
                <div>
                  <Label className="text-text-secondary">
                    Cancel at Period End
                  </Label>
                  <div className="text-text">
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
