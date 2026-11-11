import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { Cursor } from "@/components/ui/Cursor";
import { RevealObserver } from "@/components/ui/Reveal";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ArgusOps | Supervise your AI coding agents",
    template: "%s | ArgusOps",
  },
  description:
    "ArgusOps watches the AI coding agents you run, catches loops before they burn your tokens, pauses the agent, suggests a fix and alerts you. Bring your own key.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The cursor and reveal scripts add classes to <html> after load, on purpose, so React must not warn about it.
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col bg-slate-50 font-sans text-slate-900">
        {children}
        <Cursor />
        <RevealObserver />
      </body>
    </html>
  );
}
