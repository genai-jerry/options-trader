/**
 * Provider-neutral message and tool shapes used by the AdvisorService.
 *
 * Adapters in `providers/*` map to/from these. The rest of the app speaks
 * only this dialect, so swapping Anthropic ⇄ OpenAI later does not touch
 * the prompt builder or the route handlers.
 */

export type Role = 'user' | 'assistant' | 'tool';

export interface ChatTextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool input. */
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface AdvisorRunResult {
  /** Final assistant text. */
  text: string;
  /** Tool calls made during the run, in order. */
  toolCalls: { name: string; input: Record<string, unknown>; output: string }[];
}

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  data: string;
}

export interface AIProvider {
  /** One-shot synchronous run that resolves to the final assistant text + tool trace. */
  run(opts: {
    system: string;
    messages: ChatTextMessage[];
    tools: ToolDefinition[];
    toolHandler: (name: string, input: Record<string, unknown>) => Promise<string>;
    maxTurns?: number;
    model?: string;
  }): Promise<AdvisorRunResult>;

  /** Streamed chat run; emits text deltas as they arrive. */
  stream(opts: {
    system: string;
    messages: ChatTextMessage[];
    tools: ToolDefinition[];
    toolHandler: (name: string, input: Record<string, unknown>) => Promise<string>;
    onEvent: (event: StreamEvent) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void>;
}
