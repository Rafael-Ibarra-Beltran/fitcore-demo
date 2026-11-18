import { Fragment, type ReactNode } from "react";

// Markdown mínimo y seguro para respuestas del asistente: **negrita**, *cursiva*, `código`, [enlaces](https://…), listas y párrafos.
// Construye elementos React (nunca HTML en crudo), así que el texto del modelo no puede inyectar marcado.
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length}>{list.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</Tag>);
    list = null;
  };
  for (const line of text.split("\n")) {
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = !!li[2];
      if (list && list.ordered !== ordered) flush();
      (list ??= { ordered, items: [] }).items.push(li[3]);
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}
