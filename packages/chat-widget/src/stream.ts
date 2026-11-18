import { chatEvent, type ChatEvent } from "@fitcore/shared";

/** Lee una respuesta text/event-stream y emite cada evento válido. Descarta bloques que no cumplen el esquema compartido. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        try {
          const parsed = chatEvent.safeParse({ event: ev, data: JSON.parse(data) });
          if (parsed.success) yield parsed.data;
        } catch { /* bloque corrupto: se ignora */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
