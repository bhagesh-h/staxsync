import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { colorOf, takesColor } from "../lib/colors";
import { newId } from "../lib/ids";
import { kindLabel } from "../lib/markdown";
import type { Annotation } from "../lib/types";
import { ColorSwatches } from "./ColorSwatches";

interface Props {
  annotation: Annotation;
  x: number;
  y: number;
  pageLabel: string;
  autoFocus: boolean;
  onChange: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Edit one annotation: switch highlight/underline, comment, replies, delete. */
export function AnnotationPopover({ annotation: a, x, y, pageLabel, autoFocus, onChange, onDelete, onClose }: Props) {
  const [comment, setComment] = useState(a.comment);
  const [reply, setReply] = useState("");
  const [pos, setPos] = useState({ left: x, top: y });
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ comment, saved: a.comment });
  latest.current.comment = comment;

  useEffect(() => {
    setComment(a.comment);
    latest.current.saved = a.comment;
  }, [a.id, a.comment]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const top = y + h + 8 > window.innerHeight ? Math.max(8, y - h - 40) : y;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus, a.id]);

  const saveComment = () => {
    if (latest.current.comment !== latest.current.saved) {
      latest.current.saved = latest.current.comment;
      onChange({ comment: latest.current.comment });
    }
  };

  // Save a pending edit when the popover closes or switches annotation.
  useEffect(() => () => saveComment(), [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const textMarkup = a.kind === "highlight" || a.kind === "underline";

  return (
    <div
      ref={boxRef}
      className="floating popover"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={`${kindLabel(a.kind)} on page ${pageLabel}`}
      data-testid="annotation-popover"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          saveComment();
          onClose();
        }
      }}
    >
      <div className="row">
        <strong>
          {kindLabel(a.kind)} · p. {pageLabel}
        </strong>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => (saveComment(), onClose())}>
          Close
        </button>
      </div>
      {textMarkup && (
        <div className="row" role="group" aria-label="Style">
          <button className="btn btn-outline" aria-pressed={a.kind === "highlight"} onClick={() => onChange({ kind: "highlight" })}>
            Highlight
          </button>
          <button className="btn btn-outline" aria-pressed={a.kind === "underline"} onClick={() => onChange({ kind: "underline" })}>
            Underline
          </button>
        </div>
      )}
      {takesColor(a.kind) && (
        <div className="row">
          <span className="meta">Colour</span>
          <ColorSwatches value={colorOf(a) ?? null} label="Colour" onPick={(color) => onChange({ color })} />
        </div>
      )}
      {a.anchor?.exact && <blockquote>{a.anchor.exact}</blockquote>}
      <label className="meta" htmlFor={`comment-${a.id}`}>
        Comment
      </label>
      <textarea
        id={`comment-${a.id}`}
        ref={textRef}
        className="field"
        value={comment}
        placeholder="Write a comment"
        onChange={(e) => setComment(e.target.value)}
        onBlur={saveComment}
      />
      {a.replies.map((r) => (
        <div className="reply" key={r.id}>
          {r.body}
        </div>
      ))}
      <div className="row">
        <input
          className="field"
          style={{ flex: 1 }}
          placeholder="Reply"
          aria-label="Reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && reply.trim()) {
              onChange({ replies: [...a.replies, { id: newId("r"), body: reply.trim(), createdAt: new Date().toISOString() }] });
              setReply("");
            }
          }}
        />
        <button className="btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
