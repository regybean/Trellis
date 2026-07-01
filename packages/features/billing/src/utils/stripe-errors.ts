import { TRPCError } from '@trpc/server';

/**
 * Typed billing error codes.
 *
 * These replace cross-file string coupling: previously the checkout UI
 * substring-matched on the prose `message` produced deep in the Stripe
 * utilities, so a reworded message silently broke the UI branch with no test
 * to catch it. Instead we carry a stable machine code.
 *
 * The code travels in the `TRPCError.message` (which tRPC preserves verbatim to
 * the client), while the human-readable text lives in `cause`. The UI matches
 * structurally on the enum — `toBillingErrorCode(error) === BillingErrorCode.X`
 * — never on prose. Server logs still get the readable `cause`.
 */
export enum BillingErrorCode {
  NoDefaultPrice = 'BILLING_NO_DEFAULT_PRICE',
  ActiveSubscription = 'BILLING_ACTIVE_SUBSCRIPTION',
  CustomerManagementFailed = 'BILLING_CUSTOMER_MANAGEMENT_FAILED',
  NoEmail = 'BILLING_NO_EMAIL',
  NoCustomer = 'BILLING_NO_CUSTOMER',
  StripeUnavailable = 'BILLING_STRIPE_UNAVAILABLE',
  DevOnly = 'BILLING_DEV_ONLY',
  MissingPlan = 'BILLING_MISSING_PLAN',
}

type BillingTRPCCode =
  | 'BAD_REQUEST'
  | 'INTERNAL_SERVER_ERROR'
  | 'PRECONDITION_FAILED';

/**
 * Build a `TRPCError` whose `message` is a stable {@link BillingErrorCode} and
 * whose `cause` carries the human-readable explanation for logs. Throw the
 * result from any billing server code so the UI can branch structurally.
 */
export function billingError(
  code: BillingErrorCode,
  trpcCode: BillingTRPCCode,
  humanMessage: string,
): TRPCError {
  return new TRPCError({
    code: trpcCode,
    message: code,
    cause: new Error(humanMessage),
  });
}

const CODE_BY_VALUE = new Map<string, BillingErrorCode>(
  Object.values(BillingErrorCode).map((code) => [code, code]),
);

function messageOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return null;
  }
  const { message } = error;
  return typeof message === 'string' ? message : null;
}

/**
 * Structurally recover a {@link BillingErrorCode} from a thrown/serialized
 * error, or `null` if it isn't a recognised billing error. Works on both the
 * server (`TRPCError`) and the client (`TRPCClientError`, whose `message` is the
 * preserved code string) because it only reads `.message`.
 */
export function toBillingErrorCode(error: unknown): BillingErrorCode | null {
  const message = messageOf(error);
  return message === null ? null : (CODE_BY_VALUE.get(message) ?? null);
}
