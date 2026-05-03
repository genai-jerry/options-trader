/**
 * Anthropic Claude adapter for the advisor.
 *
 * Uses the Messages API with native tool calling. The agentic loop runs
 * until the model returns end_turn (no more tool_use blocks) or until
 * `maxTurns` is reached as a safety cap.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  AdvisorRunResult,
  ChatTextMessage,
  StreamEvent,
  ToolDefinition,
} from '../types.js';

interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel: string;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): AIProvider {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
    async run({ system, messages, tools, toolHandler, maxTurns = 6, model }): Promise<AdvisorRunResult> {
      const m = model ?? opts.defaultModel;
      const conv: Anthropic.MessageParam[] = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
      const toolCalls: AdvisorRunResult['toolCalls'] = [];
      let finalText = '';

      for (let turn = 0; turn < maxTurns; turn++) {
        const resp = await client.messages.create({
          model: m,
          max_tokens: 1024,
          system,
          tools: tools as Anthropic.Tool[],
          messages: conv,
        });

        const assistantBlocks = resp.content;
        // Append assistant turn to the conversation so tool_use ids resolve.
        conv.push({ role: 'assistant', content: assistantBlocks });

        const toolUses = assistantBlocks.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const texts = assistantBlocks
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        if (texts) finalText = texts;

        if (toolUses.length === 0 || resp.stop_reason === 'end_turn') {
          break;
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let output: string;
          try {
            output = await toolHandler(tu.name, tu.input as Record<string, unknown>);
          } catch (err) {
            output = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          }
          toolCalls.push({ name: tu.name, input: tu.input as Record<string, unknown>, output });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: output,
          });
        }
        conv.push({ role: 'user', content: toolResults });
      }

      return { text: finalText, toolCalls };
    },

    async stream({ system, messages, tools, toolHandler, onEvent, signal, model }): Promise<void> {
      const m = model ?? opts.defaultModel;
      const conv: Anthropic.MessageParam[] = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const maxTurns = 6;
      try {
        for (let turn = 0; turn < maxTurns; turn++) {
          if (signal?.aborted) {
            onEvent({ type: 'error', data: 'aborted' });
            return;
          }

          const stream = client.messages.stream(
            {
              model: m,
              max_tokens: 1024,
              system,
              tools: tools as Anthropic.Tool[],
              messages: conv,
            },
            { signal: signal as AbortSignal | undefined },
          );

          stream.on('text', (delta: string) => onEvent({ type: 'text', data: delta }));

          const final = await stream.finalMessage();
          conv.push({ role: 'assistant', content: final.content });

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );

          if (toolUses.length === 0 || final.stop_reason === 'end_turn') {
            onEvent({ type: 'done', data: '' });
            return;
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            onEvent({
              type: 'tool_use',
              data: JSON.stringify({ name: tu.name, input: tu.input }),
            });
            let output: string;
            try {
              output = await toolHandler(tu.name, tu.input as Record<string, unknown>);
            } catch (err) {
              output = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
            onEvent({ type: 'tool_result', data: output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: output,
            });
          }
          conv.push({ role: 'user', content: toolResults });
        }
        onEvent({ type: 'done', data: '' });
      } catch (err) {
        onEvent({ type: 'error', data: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

/** Helper: detect whether a model id is an Anthropic model id (cheap heuristic). */
export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

export type { Anthropic };
