/**
 * Lightweight SSE-over-POST helper.
 *
 * The browser EventSource API only supports GET. Our /api/advisor/chat
 * endpoint takes a POST body, so we read the response body as a stream
 * and parse SSE event frames by hand.
 */

export interface SSEEvent {
  event: string;
  data: string;
}

export async function streamSSE(
  url: string,
  body: unknown,
  onEvent: (e: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `SSE failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // SSE frames are separated by a blank line (\n\n).
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) onEvent(event);
    }
  }
}

function parseFrame(frame: string): SSEEvent | null {
  const lines = frame.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  let data = dataLines.join('\n');
  // Server JSON-encodes data payloads.
  try {
    data = JSON.parse(data) as string;
  } catch {
    /* leave as-is */
  }
  return { event, data };
}
