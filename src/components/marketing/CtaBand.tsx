import React from "react";
import { ButtonLink, Container } from "@/components/ui";

/** Closing call-to-action used at the foot of inner pages. */
export function CtaBand({
  title = "Supervise your first agent in minutes.",
  lead = "Free for two agents. Bring your own key.",
}: {
  title?: string;
  lead?: string;
}) {
  return (
    <section className="border-t border-slate-200 py-16 md:py-20" aria-label="Get started">
      <Container>
        <div data-reveal className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="max-w-xl text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-900 md:text-3xl">{title}</h2>
            <p className="mt-2 text-pretty text-base text-slate-500">{lead}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row">
            <ButtonLink href="/signup">Start free</ButtonLink>
            <ButtonLink href="/docs" variant="secondary" arrow={false}>
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
