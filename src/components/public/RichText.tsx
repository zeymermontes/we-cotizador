import type { ReactNode } from 'react';

// Texto libre de las pantallas públicas: respeta saltos de línea y convierte en
// enlaces tanto [texto](https://…) como direcciones sueltas (https://… o www.…).
// También **negritas**. Sin HTML: nada de lo que escriba el organizador se inyecta.

const TOKEN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\bwww\.[^\s<>()]+[^\s<>().,;:!?'"])|\*\*([^*\n]+)\*\*/g;

function parse(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (m[1] && m[2]) out.push(<a key={key} className="reg-link" href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>);
    else if (m[3]) out.push(<a key={key} className="reg-link" href={m[3]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    else if (m[4]) out.push(<a key={key} className="reg-link" href={`https://${m[4]}`} target="_blank" rel="noopener noreferrer">{m[4]}</a>);
    else if (m[5]) out.push(<strong key={key}>{m[5]}</strong>);
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function RichText({ text }: { text: string }) {
  const lines = (text ?? '').split('\n');
  return (
    <>
      {lines.map((l, i) => (
        <span key={i}>
          {parse(l, String(i))}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
