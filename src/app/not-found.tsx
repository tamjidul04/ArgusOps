import type { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PublicShell>
      <Container className="flex min-h-[70dvh] flex-col items-center justify-center py-32 text-center">
        <p className="font-mono text-sm text-slate-500">404</p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">This page doesn&apos;t exist</h1>
        <p className="mt-4 max-w-md text-pretty text-base leading-relaxed text-slate-600">
          The link may be old or mistyped. Try the home page, or the docs if you were looking for how something works.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/docs" variant="secondary">
            Read the docs
          </ButtonLink>
        </div>
      </Container>
    </PublicShell>
  );
}
