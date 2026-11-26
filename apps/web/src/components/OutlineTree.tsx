export interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  url?: string | null;
  items: OutlineNode[];
}

export function OutlineTree({ items, onPick }: { items: OutlineNode[]; onPick: (n: OutlineNode) => void }) {
  return (
    <ul className="outline-list">
      {items.map((n, i) => (
        <li key={`${i}-${n.title}`}>
          <button className="link" onClick={() => onPick(n)}>
            {n.title}
          </button>
          {n.items.length > 0 && <OutlineTree items={n.items} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}
