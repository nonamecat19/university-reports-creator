import { Injectable, signal, computed } from '@angular/core';
import { AIServiceClient } from '@gen/ai/ai.client';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import {
  FindingSeverity,
  FindingCategory,
  GrammarTier,
} from '@gen/ai/ai';
import type {
  AIGenerationRequest,
  AIAnalysisFinding,
  AIGrammarSuggestion,
  AISourceSuggestion,
  AIReferenceParseResult,
  AIRun,
  AIPingResult,
} from '../../shared/models/ai.model';
import { AIAction } from '../../shared/models/ai.model';
import { grpcTransport } from '../../core/grpc/transport';

const SEVERITY_MAP: Record<FindingSeverity, AIAnalysisFinding['severity']> = {
  [FindingSeverity.UNSPECIFIED]: 'info',
  [FindingSeverity.INFO]: 'info',
  [FindingSeverity.WARNING]: 'warning',
  [FindingSeverity.ERROR]: 'error',
};

const CATEGORY_MAP: Record<FindingCategory, AIAnalysisFinding['category']> = {
  [FindingCategory.UNSPECIFIED]: 'formatting',
  [FindingCategory.STRUCTURE]: 'structure',
  [FindingCategory.TOPIC_RELEVANCE]: 'topic_relevance',
  [FindingCategory.CONCLUSIONS]: 'conclusions',
  [FindingCategory.COHERENCE]: 'coherence',
  [FindingCategory.FORMATTING]: 'formatting',
};

const TIER_MAP: Record<GrammarTier, AIGrammarSuggestion['tier']> = {
  [GrammarTier.UNSPECIFIED]: 'language_tool',
  [GrammarTier.LANGUAGE_TOOL]: 'language_tool',
  [GrammarTier.LLM_STYLE]: 'llm_style',
};

function formatFindings(findings: AIAnalysisFinding[]): string {
  if (findings.length === 0) return 'No issues found.';
  return findings
    .map((f) => `[${f.severity}] ${f.category}: ${f.message}${f.anchorText ? ` — "${f.anchorText}"` : ''}`)
    .join('\n');
}

function formatGrammarSuggestions(suggestions: AIGrammarSuggestion[]): string {
  if (suggestions.length === 0) return 'No grammar issues found.';
  return suggestions
    .map((s) => `"${s.original}" → "${s.replacement}" — ${s.message}`)
    .join('\n');
}

/**
 * AI service wrapping service-ai gRPC calls via the gateway proxy.
 * Uses gRPC-web transport for browser-compatible communication.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly client = new AIServiceClient(grpcTransport);

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
      const call = this.client.generateTextStream(
        {
          userId: '',
          sessionId: request.sessionId ?? '',
          prompt: request.prompt,
          systemPrompt: request.systemPrompt ?? '',
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 4096,
          jsonMode: request.jsonMode ?? false,
          jsonSchema: '',
        },
        { abort: controller.signal }
      );

      let output = '';
      for await (const chunk of call.responses) {
        output += chunk.delta;
        this._runs.update((runs) => runs.map((r) => (r.id === runId ? { ...r, output } : r)));
        if (chunk.done) break;
      }

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId ? { ...r, status: 'completed', completedAt: new Date(), output } : r
        )
      );

      return output;
    } catch (error: any) {
      // protobuf-ts wraps an aborted call as `RpcError` with code CANCELLED,
      // not a native AbortError DOMException.
      if (error instanceof RpcError && error.code === 'CANCELLED') {
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
    this._isStreaming.set(true);

    try {
      const call = this.client.analyzeDocument({
        userId: '',
        documentId,
        content,
        topic,
        reportType,
        sections: sections.map((s) => ({ id: s.id, title: s.title, content: s.content })),
      });

      const findings: AIAnalysisFinding[] = [];
      for await (const f of call.responses) {
        findings.push({
          sectionId: f.sectionId,
          anchorText: f.anchorText,
          severity: SEVERITY_MAP[f.severity],
          category: CATEGORY_MAP[f.category],
          message: f.message,
          ordinal: f.ordinal,
        });
      }

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: formatFindings(findings),
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
    } finally {
      this._isStreaming.set(false);
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
    this._isStreaming.set(true);

    try {
      const call = this.client.correctGrammar({
        userId: '',
        text,
        language,
        includeStyle,
      });

      const suggestions: AIGrammarSuggestion[] = [];
      for await (const s of call.responses) {
        suggestions.push({
          offset: s.offset,
          length: s.length,
          original: s.original,
          replacement: s.replacement,
          message: s.message,
          tier: TIER_MAP[s.tier],
          ruleId: s.ruleId,
        });
      }

      this._runs.update((runs) =>
        runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                completedAt: new Date(),
                output: formatGrammarSuggestions(suggestions),
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
    } finally {
      this._isStreaming.set(false);
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
      const call = this.client.findSources({
        userId: '',
        sectionText,
        topic,
        citations: citations.map((c) => ({
          claim: c.claim,
          sourceTitle: c.sourceTitle,
          sourceAbstract: c.sourceAbstract,
        })),
      });

      const suggestions: AISourceSuggestion[] = [];
      for await (const s of call.responses) {
        suggestions.push({
          searchQueries: s.searchQueries,
          candidates: s.candidates.map((c) => ({
            title: c.title,
            authors: c.authors,
            year: c.year,
            url: c.url,
          })),
          warnings: s.warnings.map((w) => ({
            claim: w.claim,
            sourceTitle: w.sourceTitle,
            message: w.message,
          })),
          done: s.done,
        });
      }

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
      const resp = await this.client.parseReference({ userId: '', rawText }).response;

      const result: AIReferenceParseResult = {
        cslJson: resp.cslJson,
        title: resp.title,
        authors: resp.authors,
        year: resp.year,
        confidence: resp.confidence,
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
      const resp = await this.client.ping({}).response;
      return { status: resp.status, provider: resp.provider, model: resp.model };
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
