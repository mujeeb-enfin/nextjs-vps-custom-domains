import { memo, type ReactNode } from "react";

interface Props {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Groups cards of one kind for E2E selectors (`[data-card="…"]`). */
  testHandle?: string;
}

export const Card = memo(function Card({ id, title, action, children, testHandle }: Props) {
  return (
    <section id={id} data-card={testHandle} className="rounded-card border border-border bg-surface shadow-sm">
      <header id={`${id}_header`} className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h2 id={`${id}_title`} className="truncate text-base font-semibold text-ink">{title}</h2>
        {action}
      </header>
      <div id={`${id}_body`} className="px-5 py-5">{children}</div>
    </section>
  );
});
