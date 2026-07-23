interface AppInfo {
  pageTitle: string;
  pageDescription: string;
  systemPrompt: string;
}

const GENERIC_SYSTEM_PROMPT = `You are a helpful Q&A assistant that answers questions using the provided context.
                Some rules to follow:
                1. Never directly reference the given context in your answer.
                2. Avoid statements like 'Based on the context, ...' or 'The context information ...' or anything along those lines.
                3. If the information given is insufficient to provide a useful answer, explicitly state that you do not know the answer.
                `;

// Keyed by NEXT_PUBLIC_WEBAPP so the same chat feature can serve multiple apps.
export const NextjsAppInfo: AppInfo = {
  pageTitle: 'Acme Assistant',
  pageDescription:
    'Ask a question about your uploaded documents to get a context-aware answer.',
  systemPrompt: GENERIC_SYSTEM_PROMPT,
};

export const TanstackAppInfo: AppInfo = {
  pageTitle: 'Acme Assistant',
  pageDescription:
    'Ask a question about your uploaded documents to get a context-aware answer.',
  systemPrompt: GENERIC_SYSTEM_PROMPT,
};

export function getAppInfo(webapp: string): AppInfo {
  return webapp === 'tanstack' ? TanstackAppInfo : NextjsAppInfo;
}
