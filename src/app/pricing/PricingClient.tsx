import React from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { Bezel, ButtonLink, SectionHeading } from "@/components/ui";
import { cn, formatTokens } from "@/lib/utils";
import { PLAN_FEATURES as FEATURES } from "@/lib/plan-features";

export interface PlanData {
  plan_id: string;
  name: string;
  price: number;
  agent_limit: number;
  included_tokens: number;
  is_public: boolean;
  requires_admin_approval: boolean;
  description: string;
}

interface PricingClientProps {
  plans: PlanData[];
}

const FAQS = [
  {
    q: "Do you charge for the tokens my agents use?",
    a: "No. You bring your own model key, so your provider bills you directly. ArgusOps meters token counts to show usage and savings, and sells the supervision.",
  },
  {
    q: "Does ArgusOps see my code or prompts?",
    a: "No. The proxy runs on your machine and sends only token counts and incident reports to ArgusOps. Prompts, code and your model key stay local.",
  },
  {
    q: "What counts as a concurrent agent?",
    a: "Each supervised agent that is running at the same time. Free allows two, Pro allows ten. The limit is checked when an agent starts.",
  },
  {
    q: "How do upgrades work today?",
    a: "Upgrades are requested from the billing page and approved by an administrator until a payment gateway is connected. Paid plans become self-serve once payments ship.",
  },
  {
    q: "Which agents are supported?",
    a: "Claude Code today. Support for Codex and Gemini is planned.",
  },
];

const ROWS: { label: string; free: string | boolean; pro: string | boolean; ent: string | boolean }[] = [
  { label: "Loop detection and pause", free: true, pro: true, ent: true },
  { label: "Suggested instructions", free: true, pro: true, ent: true },
  { label: "Alerts: dashboard, desktop, VS Code", free: true, pro: true, ent: true },
  { label: "Webhooks: Slack, Discord, https", free: true, pro: true, ent: true },
  { label: "Priority support", free: false, pro: true, ent: true },
  { label: "Custom limits and terms", free: false, pro: false, ent: true },
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-emerald-600" aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  if (v === false)
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-slate-300" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  return <>{v}</>;
}

/** Plan cards, comparison table and FAQ. Server-rendered: no client JavaScript. Plan data comes from the database. */
export function PricingClient({ plans }: PricingClientProps) {
  return (
    <div className="space-y-24 md:space-y-32">
      <div data-reveal className="grid items-stretch gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const popular = plan.plan_id === "plan_pro";
          const enterprise = plan.plan_id === "plan_enterprise";
          const free = plan.plan_id === "plan_free" || plan.price === 0;
          return (
            <Bezel key={plan.plan_id} tone={popular ? "dark" : "light"} className="" innerClassName="flex flex-col sm:p-8">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">{plan.name}</h2>
                {popular && (
                  <span className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10">
                    Most popular
                  </span>
                )}
                {!popular && plan.requires_admin_approval && (
                  <span className="rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/20">
                    Manual approval
                  </span>
                )}
              </div>
              <p className={cn("mt-3 min-h-16 text-sm leading-relaxed", popular ? "text-slate-300" : "text-slate-600")}>{plan.description}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-tight">{enterprise ? "Custom" : `$${plan.price}`}</span>
                {!enterprise && <span className={cn("text-sm", popular ? "text-slate-400" : "text-slate-500")}>/ month</span>}
              </p>

              <dl className={cn("mt-6 grid grid-cols-2 gap-4 border-y py-5 text-sm", popular ? "border-white/10" : "border-slate-200")}>
                <div>
                  <dt className={cn("text-xs", popular ? "text-slate-400" : "text-slate-500")}>Concurrent agents</dt>
                  <dd className="mt-1 text-lg font-semibold">{enterprise ? "Custom" : plan.agent_limit}</dd>
                </div>
                <div>
                  <dt className={cn("text-xs", popular ? "text-slate-400" : "text-slate-500")}>Tokens / month</dt>
                  <dd className="mt-1 text-lg font-semibold">{enterprise ? "Custom" : formatTokens(plan.included_tokens)}</dd>
                </div>
              </dl>

              <ul className={cn("mt-6 flex-1 space-y-3 text-sm", popular ? "text-slate-200" : "text-slate-700")}>
                {(FEATURES[plan.plan_id] ?? FEATURES.plan_free).map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check className={cn("mt-0.5 h-4 w-4 shrink-0", popular ? "text-emerald-400" : "text-emerald-600")} aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <ButtonLink
                  href={free ? "/signup" : `/dashboard/billing?plan=${plan.plan_id}`}
                  variant={popular ? "inverse" : "secondary"}
                  className="w-full justify-between"
                >
                  {free ? "Start free" : enterprise ? "Talk to us" : "Upgrade to Pro"}
                </ButtonLink>
                {plan.requires_admin_approval && <p className="mt-3 text-center text-xs text-slate-500">Reviewed by an administrator before it activates</p>}
              </div>
            </Bezel>
          );
        })}
      </div>

      <section data-reveal aria-labelledby="compare-title">
        <SectionHeading id="compare-title" eyebrow="Compare" title="What’s in each plan." />
        <div className="mt-10 overflow-x-auto rounded-lg bg-white border border-slate-200">
          <table className="w-full text-left text-[13px] sm:min-w-[34rem] sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th scope="col" className="px-6 py-4 font-medium">
                  Feature
                </th>
                <th scope="col" className="px-2 py-3 sm:px-4 sm:py-4 text-center font-medium">
                  Free
                </th>
                <th scope="col" className="px-2 py-3 sm:px-4 sm:py-4 text-center font-medium">
                  Pro
                </th>
                <th scope="col" className="px-2 py-3 sm:px-4 sm:py-4 text-center font-medium">
                  Enterprise
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="px-6 py-4 font-medium text-slate-900">
                    {r.label}
                  </th>
                  <td className="px-2 py-3 sm:px-4 sm:py-4 text-center">
                    <Cell v={r.free} />
                  </td>
                  <td className="px-2 py-3 sm:px-4 sm:py-4 text-center">
                    <Cell v={r.pro} />
                  </td>
                  <td className="px-2 py-3 sm:px-4 sm:py-4 text-center">
                    <Cell v={r.ent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section data-reveal aria-labelledby="faq-title" className="mx-auto max-w-3xl">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered." align="center" />
        <div className="mt-10 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-lg bg-white px-5 border border-slate-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ease-spring group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
