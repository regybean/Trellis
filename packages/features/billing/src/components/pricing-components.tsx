// UI subcomponents for pricing page
import { Check, X } from 'lucide-react';

import type { PricingFeature } from '../data/pricing-data';

export const ButtonSkeleton = ({ colors }: { colors: { button: string } }) => (
  <div
    className={`mb-6 flex h-10 w-full animate-pulse items-center justify-center rounded-md ${colors.button} opacity-70`}
  >
    <div className="h-4 w-20 rounded-sm bg-white/30"></div>
  </div>
);

export const FeaturesList = ({ features }: { features: PricingFeature[] }) => (
  <div className="space-y-3">
    <h4 className="text-foreground font-medium">Features included:</h4>
    <ul className="space-y-2">
      {features.map((feature, i) => (
        <li key={i} className="flex items-start space-x-3">
          {feature.included ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
          ) : (
            <X className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <span
              className={`text-sm ${
                feature.included
                  ? 'text-foreground'
                  : 'text-muted-foreground line-through'
              }`}
            >
              {feature.name}
            </span>
            {feature.description && feature.included && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {feature.description}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  </div>
);
