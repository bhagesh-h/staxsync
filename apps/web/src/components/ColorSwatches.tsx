import { HIGHLIGHT_COLORS } from "../lib/colors";
import type { HighlightColor } from "../lib/types";

interface Props {
  value: HighlightColor | null;
  /** Accessible name prefix, e.g. "Highlight" gives "Highlight red". */
  label: string;
  onPick: (color: HighlightColor) => void;
  keepSelection?: boolean;
}

/** Four colour buttons (RGBY). The colour name is always in the accessible name, never colour alone. */
export function ColorSwatches({ value, label, onPick, keepSelection }: Props) {
  return (
    <span className="swatches" role="group" aria-label={`${label} colour`}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.color}
          type="button"
          className={`swatch c-${c.color}`}
          aria-label={`${label} ${c.label.toLowerCase()}`}
          aria-pressed={value === c.color}
          title={`${c.label} (${c.key})`}
          onPointerDown={keepSelection ? (e) => e.preventDefault() : undefined}
          onMouseDown={keepSelection ? (e) => e.preventDefault() : undefined}
          onClick={() => onPick(c.color)}
        />
      ))}
    </span>
  );
}
