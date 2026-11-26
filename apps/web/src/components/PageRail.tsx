import { useEffect, useRef } from "react";

interface Props {
  page: number;
  count: number;
  label: (index: number) => string;
  onPick: (page: number) => void;
}

/**
 * Page rail: a narrow bar of page numbers in place of a scrollbar. The current page is orange
 * in a rounded pill; click any number to go there. The rail keeps the current page in view.
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
