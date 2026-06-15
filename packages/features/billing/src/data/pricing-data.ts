// Pricing data, types, and utility functions
import { BarChart3, FileText, HelpCircle, MessageSquare } from 'lucide-react';

import { env } from '../env';

export interface PricingFeature {
  name: string;
  included: boolean;
  description?: string;
}

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  credits: number | null;
  highlight: boolean;
  popular: boolean;
  cta: string;
  features: PricingFeature[];
}

export const pricingPlans: PricingPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    description: 'Essential features for getting started',
    monthlyPrice: 0,
    credits: 250,
    highlight: false,
    popular: false,
    cta: 'Start Free',
    features: [
      {
        name: 'AI Chat Assistant',
        included: true,
        description: 'AI assistant for your documents',
      },
      {
        name: '250 Monthly Credits',
        included: true,
        description: 'Resets monthly from subscription start date',
      },
      {
        name: 'Document Uploads',
        included: true,
        description: 'Limited questions',
      },
      {
        name: 'Email Support',
        included: true,
        description: 'Standard email support',
      },
    ],
  },
  {
    id: env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
    name: 'Standard',
    description: 'Perfect for individuals and small teams getting started',
    monthlyPrice: 30,
    credits: 350,
    highlight: false,
    popular: true,
    cta: 'Choose Standard',
    features: [
      {
        name: 'Everything in Basic',
        included: true,
        description: 'All Basic features included',
      },
      {
        name: 'Unlimited Chat',
        included: true,
        description: 'Chat across your uploaded documents',
      },
      {
        name: 'Priority Support',
        included: true,
        description: 'Priority email support',
      },
      {
        name: '350 Monthly Credits',
        included: true,
        description: 'Resets monthly from subscription start date',
      },
    ],
  },
  {
    id: env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID,
    name: 'Pro',
    description: 'For growing teams with higher usage needs',
    monthlyPrice: 80,
    credits: 1600,
    highlight: true,
    popular: false,
    cta: 'Go Pro',
    features: [
      {
        name: 'Everything in Standard',
        included: true,
        description: 'All Standard features included',
      },
      {
        name: '1,600 Monthly Credits',
        included: true,
        description: 'Extra credits for a reduced rate',
      },
    ],
  },
];

export const enterprisePlan: PricingPlan = {
  id: 'enterprise',
  name: 'Enterprise',
  description: 'Custom solutions for large organisations',
  monthlyPrice: null,
  credits: null,
  highlight: false,
  popular: false,
  cta: 'Contact Sales',
  features: [
    {
      name: 'Everything in Pro',
      included: true,
      description: 'All Pro features included',
    },
    {
      name: 'Unlimited Credits',
      included: true,
      description: 'No usage limits',
    },
    {
      name: 'Team Management',
      included: true,
      description: 'User roles and permissions',
    },
    {
      name: 'Dedicated Support',
      included: true,
      description: 'Priority support',
    },
    {
      name: 'Custom Training',
      included: true,
      description: 'Onboarding and team training',
    },
    {
      name: 'SLA Guarantee',
      included: true,
      description: '99.9% uptime guarantee',
    },
    {
      name: 'Custom Deployments',
      included: true,
      description: 'Private cloud options',
    },
  ],
};

export const creditUsageExamples = [
  {
    icon: MessageSquare,
    title: 'AI Assistant Messages',
    description: 'Each message to the AI assistant',
    credits: '1 credit per message',
  },
  {
    icon: FileText,
    title: 'Document Questions',
    description: 'Questions asked about your documents',
    credits: '1 credit per question',
  },
  {
    icon: BarChart3,
    title: 'Document Summaries',
    description: 'AI-generated summaries of your documents',
    credits: '1 credit per summary',
  },
  {
    icon: HelpCircle,
    title: 'Additional Questions',
    description: 'Follow-up questions based on document context',
    credits: '1 credit per question',
  },
];

export const getTierColors = (
  planId: string,
  popular: boolean,
  highlight: boolean,
) => {
  switch (planId) {
    case 'basic': {
      return {
        border: 'border-slate-200 dark:border-slate-700',
        accent: 'text-slate-700 dark:text-slate-300',
        button: 'bg-slate-700 hover:bg-slate-800 text-white',
        badge: 'bg-slate-700',
      };
    }
    case env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: {
      return {
        border: popular
          ? 'border-blue-200 ring-1 ring-blue-100 dark:border-blue-700 dark:ring-blue-800'
          : 'border-blue-200 dark:border-blue-700',
        accent: 'text-blue-700 dark:text-blue-300',
        button: 'bg-blue-600 hover:bg-blue-700 text-white',
        badge: 'bg-blue-600',
      };
    }
    case env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: {
      return {
        border: highlight
          ? 'border-violet-200 ring-1 ring-violet-100 dark:border-violet-700 dark:ring-violet-800'
          : 'border-violet-200 dark:border-violet-700',
        accent: 'text-violet-700 dark:text-violet-300',
        button: 'bg-violet-600 hover:bg-violet-700 text-white',
        badge: 'bg-violet-600',
      };
    }
    case 'enterprise': {
      return {
        border:
          'border-amber-200 ring-1 ring-amber-100 dark:border-amber-700 dark:ring-amber-800',
        accent: 'text-amber-700 dark:text-amber-300',
        button: 'bg-amber-600 hover:bg-amber-700 text-white',
        badge: 'bg-amber-600',
      };
    }
    default: {
      return {
        border: 'border-border',
        accent: 'text-accent-foreground',
        button: 'bg-primary hover:bg-primary/90 text-on-primary',
        badge: 'bg-primary',
      };
    }
  }
};

const getPlanHierarchy = (planName: string): number => {
  switch (planName) {
    case 'Basic': {
      return 0;
    }
    case 'Standard': {
      return 1;
    }
    case 'Pro': {
      return 2;
    }
    case 'Enterprise': {
      return 3;
    }
    default: {
      return 0;
    }
  }
};

const getPlanChangeType = (
  currentPlan: string,
  targetPlan: string,
): 'upgrade' | 'downgrade' | 'same' => {
  const currentLevel = getPlanHierarchy(currentPlan);
  const targetLevel = getPlanHierarchy(targetPlan);

  if (targetLevel > currentLevel) return 'upgrade';
  if (targetLevel < currentLevel) return 'downgrade';
  return 'same';
};

export const getButtonState = (
  plan: PricingPlan,
  currentSubscription: string | undefined = 'Basic',
  isSubscriptionLoading = false,
  isAuthenticated = true,
  isAuthLoaded = true,
) => {
  if (!isAuthLoaded) {
    return {
      text: 'Loading...',
      disabled: true,
      variant: 'loading' as const,
    };
  }
  if (!isAuthenticated) {
    return {
      text: plan.id === 'basic' ? 'Login to Start' : `Choose ${plan.name}`,
      disabled: false,
      variant: 'signin' as const,
    };
  }
  if (isSubscriptionLoading) {
    return {
      text: 'Loading...',
      disabled: true,
      variant: 'loading' as const,
    };
  }
  const current = currentSubscription;
  if (plan.name === current) {
    return {
      text: 'Current Plan',
      disabled: true,
      variant: 'selected' as const,
    };
  }
  if (current !== 'Basic' && plan.id === 'basic') {
    return {
      text: 'Downgrade to Basic',
      disabled: true,
      variant: 'downgrade' as const,
    };
  }
  if (
    current === 'Basic' &&
    plan.monthlyPrice !== null &&
    plan.monthlyPrice > 0
  ) {
    return {
      text: `Choose ${plan.name}`,
      disabled: false,
      variant: 'purchase' as const,
    };
  }
  if (
    current !== 'Basic' &&
    plan.monthlyPrice !== null &&
    plan.monthlyPrice > 0
  ) {
    const changeType = getPlanChangeType(current, plan.name);
    if (changeType === 'upgrade') {
      return {
        text: `Upgrade to ${plan.name}`,
        disabled: false,
        variant: 'upgrade' as const,
      };
    } else if (changeType === 'downgrade') {
      return {
        text: `Downgrade to ${plan.name}`,
        disabled: false,
        variant: 'downgrade' as const,
      };
    }
  }
  return {
    text: plan.cta,
    disabled: false,
    variant: 'default' as const,
  };
};
