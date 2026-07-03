export enum AIAction {
  ANALYZE = 'analyze',
  GRAMMAR = 'grammar',
  DRAFT = 'draft',
  CONTINUE = 'continue',
  REPHRASE = 'rephrase',
  EXPAND = 'expand',
  CONDENSE = 'condense',
  TRANSLATE = 'translate',
  SOURCES = 'sources',
  PARSE_REFERENCE = 'parse_reference',
}

export interface AIGenerationRequest {
  action: AIAction;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  sessionId?: string;
  documentId?: string;
  topic?: string;
  reportType?: string;
  sectionTitle?: string;
}

export interface AIGenerationChunk {
  delta: string;
  done: boolean;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AIAnalysisFinding {
  sectionId: string;
  anchorText: string;
  severity: 'info' | 'warning' | 'error';
  category: 'structure' | 'topic_relevance' | 'conclusions' | 'coherence' | 'formatting';
  message: string;
  ordinal: number;
}

export interface AIGrammarSuggestion {
  offset: number;
  length: number;
  original: string;
  replacement: string;
  message: string;
  tier: 'language_tool' | 'llm_style';
  ruleId: string;
}

export interface AISourceSuggestion {
  searchQueries: string[];
  candidates: Array<{
    title: string;
    authors: string;
    year: string;
    url: string;
  }>;
  warnings: Array<{
    claim: string;
    sourceTitle: string;
    message: string;
  }>;
  done: boolean;
}

export interface AIReferenceParseResult {
  cslJson: string;
  title: string;
  authors: string;
  year: string;
  confidence: boolean;
}

export interface AIRun {
  id: string;
  action: AIAction;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  prompt: string;
  output: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface AIPingResult {
  status: string;
  provider: string;
  model: string;
}

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  [AIAction.ANALYZE]: 'Analyze Document',
  [AIAction.GRAMMAR]: 'Check Grammar',
  [AIAction.DRAFT]: 'Draft Section',
  [AIAction.CONTINUE]: 'Continue Writing',
  [AIAction.REPHRASE]: 'Rephrase',
  [AIAction.EXPAND]: 'Expand',
  [AIAction.CONDENSE]: 'Condense',
  [AIAction.TRANSLATE]: 'Translate',
  [AIAction.SOURCES]: 'Find Sources',
  [AIAction.PARSE_REFERENCE]: 'Parse Reference',
};

export const AI_ACTION_ICONS: Record<AIAction, string> = {
  [AIAction.ANALYZE]: 'pi pi-search',
  [AIAction.GRAMMAR]: 'pi pi-check-circle',
  [AIAction.DRAFT]: 'pi pi-pencil',
  [AIAction.CONTINUE]: 'pi pi-arrow-right',
  [AIAction.REPHRASE]: 'pi pi-sync',
  [AIAction.EXPAND]: 'pi pi-arrows-h',
  [AIAction.CONDENSE]: 'pi pi-minus-circle',
  [AIAction.TRANSLATE]: 'pi pi-globe',
  [AIAction.SOURCES]: 'pi pi-book',
  [AIAction.PARSE_REFERENCE]: 'pi pi-list',
};
