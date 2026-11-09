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
    <section className="pb-20 md:pb-32" aria-label="Get started">
      <Container>
        <div className="on-dark reveal rounded-[2rem] bg-slate-950 px-6 py-14 text-center shadow-lift ring-1 ring-slate-900/10 sm:px-12 md:py-20">
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold leading-[1.1] tracking-tight text-white md:text-5xl">{title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-slate-300 sm:text-lg">{lead}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" variant="inverse">
              Start free
            </ButtonLink>
            <ButtonLink href="/docs" variant="ghost" className="text-slate-200 hover:bg-white/10 hover:text-white" arrow={false}>
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
