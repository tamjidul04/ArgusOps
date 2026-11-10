/**
 * What each plan includes, in words. Shared by the public pricing page and the dashboard billing page so the
 * two can never disagree. Limits (agents, tokens) are NOT here: they come from the plan rows in the database.
 */
export const PLAN_FEATURES: Record<string, string[]> = {
  plan_free: [
    "Loop detection and automatic pause",
    "Suggested instructions you approve",
    "Dashboard, desktop and webhook alerts",
    "VS Code extension",
    "Usage and savings page",
  ],
  plan_pro: ["Everything in Free", "5x the concurrent agents", "More agents running side by side", "Priority support"],
  plan_enterprise: ["Everything in Pro", "Limits and terms agreed for your team", "Dedicated support channel"],
};
