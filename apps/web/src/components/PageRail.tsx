import { useEffect, useRef } from "react";

interface Props {
  page: number;
  count: number;
  label: (index: number) => string;
  onPick: (page: number) => void;
}

/**
 * Page rail: a narrow bar of page numbers in place of a scrollbar, on the same paper as the rest
 * of the interface. Numbers are ink (black on the light theme, white on the dark); the current
 * page is orange in a rounded pill. Click any number to go there; the current page stays in view.
 */
export function PageRail({ page, count, label, onPick }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [page]);

  return (
    <nav className="page-rail" aria-label="Pages" data-testid="page-rail">
      <ol ref={listRef}>
        {Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          return (
            <li key={n}>
              <button
                type="button"
                className="page-rail-item"
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${label(i)}`}
                onClick={() => onPick(n)}
              >
                {label(i)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
