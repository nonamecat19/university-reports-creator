import { Injectable, signal, computed } from '@angular/core';
import type {
  AIGenerationRequest,
  AIGenerationChunk,
  AIAnalysisFinding,
  AIGrammarSuggestion,
  AISourceSuggestion,
  AIReferenceParseResult,
  AIRun,
  AIPingResult,
} from '../../shared/models/ai.model';
import { AIAction } from '../../shared/models/ai.model';
import { grpcTransport } from '../../core/grpc/transport';

/**
 * AI service wrapping service-ai gRPC calls via the gateway proxy.
 * Uses gRPC-web transport for browser-compatible communication.
 *
 * NOTE: Once proto stubs are generated from proto/ai/ai.proto,
 * replace the raw fetch calls with the generated AIServiceClient.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly _runs = signal<AIRun[]>([]);
  private readonly _isStreaming = signal(false);
  private readonly _abortController = signal<AbortController | null>(null);

  readonly runs = this._runs.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();
  readonly latestRun = computed(() => this._runs()[0] ?? null);
  readonly runHistory = computed(() => this._runs().slice(1));

  /**
   * Generate text (streaming) — fires a server-streaming RPC and
   * accumulates chunks into the current run's output.
   */
  async generateStream(request: AIGenerationRequest): Promise<string> {
    const runId = crypto.randomUUID();
    const run: AIRun = {
      id: runId,
      action: request.action,
      status: 'running',
      prompt: request.prompt,
      output: '',
      startedAt: new Date(),
    };

    this._runs.update((runs) => [run, ...runs]);
    this._isStreaming.set(true);

    const controller = new AbortController();
    this._abortController.set(controller);

    try {
      const response = await fetch('http://localhost:8080/ai.AIService/GenerateTextStream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.prompt,
          systemPrompt: request.systemPrompt ?? '',
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 4096,
          jsonMode: request.jsonMode ?? false,
          sessionId: request.sessionId ?? '',
          userId: '',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let output = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        // Parse SSE-style chunks
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk: AIGenerationChunk = JSON.parse(line.slice(6));
              output += chunk.delta;
              this._runs.update((runs) =>
                runs.map((r) => (r.id === runId ? { ...r, output } : r))
              );
              if (chunk.done) break;
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId ? { ...r, status: 'completed', completedAt: new Date(), output } : r
        )
      );

      return output;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this._runs.update((runs) =>
          runs.map((r) =>
            r.id === runId ? { ...r, status: 'cancelled', completedAt: new Date() } : r
          )
        );
        return '';
      }

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? { ...r, status: 'error', error: error.message, completedAt: new Date() }
            : r
        )
      );
      throw error;
    } finally {
      this._isStreaming.set(false);
      this._abortController.set(null);
    }
  }

  /**
   * Cancel the currently streaming generation.
   */
  cancelCurrent(): void {
    const controller = this._abortController();
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Analyze document — returns structured findings.
   * (FR-AI-08, FR-AI-09)
   */
  async analyzeDocument(
    documentId: string,
    content: string,
    topic: string,
    reportType: string,
    sections: Array<{ id: string; title: string; content: string }>
  ): Promise<AIAnalysisFinding[]> {
    const runId = crypto.randomUUID();
    const run: AIRun = {
      id: runId,
      action: AIAction.ANALYZE,
      status: 'running',
      prompt: `Analyze document: ${topic}`,
      output: '',
      startedAt: new Date(),
    };

    this._runs.update((runs) => [run, ...runs]);

    try {
      // TODO: Replace with generated proto client call
      // const client = new AIServiceClient(grpcTransport);
      // const stream = client.analyzeDocument({...});
      // For now, use mock response
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const findings: AIAnalysisFinding[] = [];

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: JSON.stringify(findings, null, 2),
              }
            : r
        )
      );

      return findings;
    } catch (error: any) {
      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? { ...r, status: 'error', error: error.message, completedAt: new Date() }
            : r
        )
      );
      throw error;
    }
  }

  /**
   * Grammar check — returns suggestions.
   * (FR-AI-11)
   */
  async checkGrammar(
    text: string,
    language = 'uk',
    includeStyle = true
  ): Promise<AIGrammarSuggestion[]> {
    const runId = crypto.randomUUID();
    const run: AIRun = {
      id: runId,
      action: AIAction.GRAMMAR,
      status: 'running',
      prompt: `Check grammar (${language})`,
      output: '',
      startedAt: new Date(),
    };

    this._runs.update((runs) => [run, ...runs]);

    try {
      // TODO: Replace with generated proto client call
      await new Promise((resolve) => setTimeout(resolve, 500));

      const suggestions: AIGrammarSuggestion[] = [];

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: JSON.stringify(suggestions, null, 2),
              }
            : r
        )
      );

      return suggestions;
    } catch (error: any) {
      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? { ...r, status: 'error', error: error.message, completedAt: new Date() }
            : r
        )
      );
      throw error;
    }
  }

  /**
   * Find sources for a section.
   * (FR-AI-13, FR-AI-14, FR-AI-15)
   */
  async findSources(
    sectionText: string,
    topic: string,
    citations: Array<{ claim: string; sourceTitle: string; sourceAbstract: string }> = []
  ): Promise<AISourceSuggestion[]> {
    const runId = crypto.randomUUID();
    const run: AIRun = {
      id: runId,
      action: AIAction.SOURCES,
      status: 'running',
      prompt: `Find sources for: ${topic}`,
      output: '',
      startedAt: new Date(),
    };

    this._runs.update((runs) => [run, ...runs]);

    try {
      // TODO: Replace with generated proto client call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const suggestions: AISourceSuggestion[] = [];

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: JSON.stringify(suggestions, null, 2),
              }
            : r
        )
      );

      return suggestions;
    } catch (error: any) {
      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? { ...r, status: 'error', error: error.message, completedAt: new Date() }
            : r
        )
      );
      throw error;
    }
  }

  /**
   * Parse a freeform reference string into CSL-JSON.
   * (FR-AI-13)
   */
  async parseReference(rawText: string): Promise<AIReferenceParseResult> {
    const runId = crypto.randomUUID();
    const run: AIRun = {
      id: runId,
      action: AIAction.PARSE_REFERENCE,
      status: 'running',
      prompt: `Parse: ${rawText.substring(0, 50)}...`,
      output: '',
      startedAt: new Date(),
    };

    this._runs.update((runs) => [run, ...runs]);

    try {
      // TODO: Replace with generated proto client call
      await new Promise((resolve) => setTimeout(resolve, 800));

      const result: AIReferenceParseResult = {
        cslJson: '{}',
        title: '',
        authors: '',
        year: '',
        confidence: false,
      };

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: JSON.stringify(result, null, 2),
              }
            : r
        )
      );

      return result;
    } catch (error: any) {
      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? { ...r, status: 'error', error: error.message, completedAt: new Date() }
            : r
        )
      );
      throw error;
    }
  }

  /**
   * Ping the AI service to check health and provider status.
   */
  async ping(): Promise<AIPingResult> {
    try {
      // TODO: Replace with generated proto client call
      return { status: 'ok', provider: 'ollama', model: 'gemma3:8b' };
    } catch {
      return { status: 'unavailable', provider: 'unknown', model: 'unknown' };
    }
  }

  /**
   * Clear run history.
   */
  clearHistory(): void {
    this._runs.set([]);
  }
}
