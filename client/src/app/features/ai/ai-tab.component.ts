import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputTextarea } from 'primeng/inputtextarea';
import { ProgressSpinner } from 'primeng/progressspinner';
import { ScrollPanel } from 'primeng/scrollpanel';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { AiService } from './ai.service';
import {
  AIAction,
  AI_ACTION_LABELS,
  AI_ACTION_ICONS,
  type AIRun,
} from '../../shared/models/ai.model';

@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [FormsModule, Button, InputTextarea, ProgressSpinner, ScrollPanel, Tag, Tooltip],
  template: `
    <div class="ai-tab">
      <!-- Header -->
      <div class="ai-tab-header">
        <div class="ai-tab-title">
          <i class="pi pi-sparkles"></i>
          <span>AI Assistant</span>
        </div>
        @if (aiService.isStreaming()) {
          <p-button
            icon="pi pi-stop"
            size="small"
            severity="danger"
            (onClick)="cancelGeneration()"
            pTooltip="Cancel generation"
          />
        }
      </div>

      <!-- Quick actions -->
      <div class="ai-actions">
        @for (action of quickActions; track action) {
          <p-button
            [label]="actionLabels[action]"
            [icon]="actionIcons[action]"
            size="small"
            [outlined]="true"
            (onClick)="selectAction(action)"
            [class.active]="selectedAction() === action"
            styleClass="ai-action-btn"
          />
        }
      </div>

      <!-- Input area -->
      <div class="ai-input-area">
        <textarea
          pInputTextarea
          [placeholder]="inputPlaceholder()"
          [(ngModel)]="inputText"
          rows="3"
          class="ai-input"
          [disabled]="aiService.isStreaming()"
        ></textarea>

        <div class="ai-input-actions">
          <p-button
            icon="pi pi-send"
            [label]="aiService.isStreaming() ? 'Generating...' : 'Send'"
            [disabled]="!canSend() || aiService.isStreaming()"
            (onClick)="send()"
            styleClass="send-btn"
          />
        </div>
      </div>

      <!-- Streaming output -->
      @if (aiService.isStreaming() && currentOutput()) {
        <div class="ai-output streaming">
          <div class="ai-output-header">
            <p-progressSpinner strokeWidth="2" [style]="{ width: '16px', height: '16px' }" />
            <span>Generating...</span>
          </div>
          <p-scrollPanel [style]="{ height: '300px' }">
            <div class="ai-output-text">{{ currentOutput() }}</div>
          </p-scrollPanel>
        </div>
      }

      <!-- Run history -->
      @if (completedRuns().length > 0) {
        <div class="ai-history">
          <div class="ai-history-header">
            <span>History</span>
            <p-button
              icon="pi pi-trash"
              size="small"
              [text]="true"
              severity="secondary"
              (onClick)="aiService.clearHistory()"
              pTooltip="Clear history"
            />
          </div>

          @for (run of completedRuns(); track run.id) {
            <div class="ai-run" [class.error]="run.status === 'error'" [class.cancelled]="run.status === 'cancelled'">
              <div class="ai-run-header">
                <p-tag
                  [value]="actionLabels[run.action]"
                  [severity]="run.status === 'completed' ? 'success' : run.status === 'error' ? 'danger' : 'warn'"
                  styleClass="run-tag"
                />
                <span class="ai-run-time">
                  {{ formatTime(run.startedAt) }}
                  @if (run.completedAt) {
                    — {{ formatTime(run.completedAt) }}
                  }
                </span>
              </div>

              @if (run.status === 'error') {
                <div class="ai-run-error">{{ run.error }}</div>
              } @else if (run.status === 'cancelled') {
                <div class="ai-run-cancelled">Cancelled</div>
              } @else {
                <p-scrollPanel [style]="{ height: '150px' }">
                  <div class="ai-run-output">{{ run.output }}</div>
                </p-scrollPanel>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .ai-tab {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--p-surface-0);
      border-left: 1px solid var(--p-content-border);
    }

    .ai-tab-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .ai-tab-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--p-text-color);
    }

    .ai-tab-title i {
      color: var(--p-primary-color);
    }

    .ai-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .ai-actions :host ::ng-deep .ai-action-btn {
      font-size: 0.75rem !important;
      padding: 0.25rem 0.5rem !important;
    }

    .ai-actions :host ::ng-deep .ai-action-btn.active {
      background: var(--p-primary-color) !important;
      color: var(--p-primary-contrast-color) !important;
      border-color: var(--p-primary-color) !important;
    }

    .ai-input-area {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .ai-input {
      width: 100%;
      resize: none;
      font-size: 0.85rem;
    }

    .ai-input-actions {
      display: flex;
      justify-content: flex-end;
    }

    .ai-output {
      background: var(--p-surface-50);
      border-radius: 8px;
      padding: 0.75rem;
      border: 1px solid var(--p-content-border);
    }

    .ai-output-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }

    .ai-output-text {
      font-size: 0.85rem;
      line-height: 1.6;
      white-space: pre-wrap;
      font-family: var(--p-font-family);
    }

    .ai-history {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .ai-history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .ai-run {
      background: var(--p-surface-50);
      border-radius: 8px;
      padding: 0.75rem;
      border: 1px solid var(--p-content-border);
    }

    .ai-run.error {
      border-color: var(--p-red-500);
    }

    .ai-run.cancelled {
      border-color: var(--p-yellow-500);
    }

    .ai-run-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .ai-run-time {
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }

    .ai-run-output {
      font-size: 0.8rem;
      line-height: 1.5;
      white-space: pre-wrap;
      color: var(--p-text-color);
    }

    .ai-run-error {
      font-size: 0.8rem;
      color: var(--p-red-500);
    }

    .ai-run-cancelled {
      font-size: 0.8rem;
      color: var(--p-yellow-500);
      font-style: italic;
    }
  `,
})
export class AiTabComponent {
  readonly aiService = inject(AiService);

  readonly actionLabels = AI_ACTION_LABELS;
  readonly actionIcons = AI_ACTION_ICONS;

  readonly selectedAction = signal<AIAction>(AIAction.DRAFT);
  readonly inputText = signal('');

  readonly quickActions: AIAction[] = [
    AIAction.ANALYZE,
    AIAction.GRAMMAR,
    AIAction.DRAFT,
    AIAction.REPHRASE,
    AIAction.TRANSLATE,
    AIAction.SOURCES,
  ];

  readonly inputPlaceholder = computed(() => {
    const action = this.selectedAction();
    switch (action) {
      case AIAction.ANALYZE:
        return 'Paste document content to analyze...';
      case AIAction.GRAMMAR:
        return 'Paste text to check grammar...';
      case AIAction.DRAFT:
        return 'Describe what to write (bullet points)...';
      case AIAction.CONTINUE:
        return 'Paste preceding text to continue from...';
      case AIAction.REPHRASE:
        return 'Paste text to rephrase...';
      case AIAction.EXPAND:
        return 'Paste text to expand...';
      case AIAction.CONDENSE:
        return 'Paste text to condense...';
      case AIAction.TRANSLATE:
        return 'Paste text to translate (uk↔en)...';
      case AIAction.SOURCES:
        return 'Describe the topic to find sources for...';
      case AIAction.PARSE_REFERENCE:
        return 'Paste a reference string to parse...';
      default:
        return 'Enter your prompt...';
    }
  });

  readonly canSend = computed(() => this.inputText().trim().length > 0);

  readonly currentOutput = computed(() => {
    const runs = this.aiService.runs();
    const current = runs.find((r) => r.status === 'running');
    return current?.output ?? '';
  });

  readonly completedRuns = computed(() =>
    this.aiService.runs().filter((r) => r.status !== 'running')
  );

  selectAction(action: AIAction): void {
    this.selectedAction.set(action);
  }

  cancelGeneration(): void {
    this.aiService.cancelCurrent();
  }

  async send(): Promise<void> {
    const prompt = this.inputText().trim();
    if (!prompt) return;

    const action = this.selectedAction();

    try {
      await this.aiService.generateStream({
        action,
        prompt,
        temperature: action === AIAction.GRAMMAR ? 0.3 : 0.7,
        maxTokens: 4096,
      });

      this.inputText.set('');
    } catch (error) {
      console.error('AI generation failed:', error);
    }
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
