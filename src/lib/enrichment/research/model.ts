import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { enrichmentUserAgent } from "../user-agent";
import { QuotaStop } from "../source-cache";
import type { ExtractionRequest } from "./request";

/*
 * The extraction model (SLN-461's choice: claude-opus-5-5) behind one
 * adapter, through the official SDK (@anthropic-ai/sdk, MIT, Pablo's yes of
 * 7 Oct). The request is sent as built and hashed; the answer is the model's
 * text, checked against the schema by the caller. A 429 or a refused key
 * stops the run (the job is held); a call without an answer fails the job.
 */

export interface ModelAnswer {
  /** The model that answered: an answer of another model is invalid */
  model: string;
  stopReason: string | null;
  /** The text blocks of the answer, joined */
  text: string;
  /** The units billed, as the price table names them */
  usage: Record<string, number>;
}

export interface ExtractionModel {
  /** Input tokens of a request, from the provider's free count */
  countTokens(request: ExtractionRequest): Promise<number>;
  send(request: ExtractionRequest): Promise<ModelAnswer>;
}

/** No answer came back: the call is not billed */
export class ModelFailure extends Error {
  readonly billed = false;
}

/** A refusal of the key or the rate stops the run like a search refusal */
function stopOn(error: unknown): never {
  if (error instanceof APIError && (error.status === 429 || error.status === 401 || error.status === 403)) {
    const stop = new QuotaStop(`The extraction model refused a call (HTTP ${error.status})`, 0, error.status === 429 ? "rate_limited" : "quota");
    throw Object.assign(stop, { billed: false });
  }
  throw new ModelFailure(error instanceof APIError ? `The extraction model answered ${error.status ?? "nothing"}` : "The extraction model could not be reached");
}

/** The SDK's client for one key: no retries (a failed job retries with its backoff), the enrichment User-Agent */
export const anthropicClient = (apiKey: string, timeout = 180_000) =>
  new Anthropic({ apiKey, maxRetries: 0, timeout, defaultHeaders: { "User-Agent": enrichmentUserAgent() } });

export function anthropicModel(apiKey: string): ExtractionModel {
  const client = anthropicClient(apiKey);
  return {
    async countTokens(request) {
      try {
        // The output format counts too: the schema joins the input
        const { model, system, messages, output_config } = request;
        const counted = await client.messages.countTokens({ model, system, messages, output_config } as unknown as Anthropic.MessageCountTokensParams);
        return counted.input_tokens;
      } catch (error) {
        return stopOn(error);
      }
    },
    async send(request) {
      try {
        const message = await client.messages.create(request as unknown as MessageCreateParamsNonStreaming);
        return {
          model: message.model,
          stopReason: message.stop_reason,
          text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (error) {
        return stopOn(error);
      }
    },
  };
}
