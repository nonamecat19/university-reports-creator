import { AnalysisFinding, AnalyzeDocumentRequest, CorrectGrammarRequest, GenerateTextChunk, GenerateTextRequest, GrammarSuggestion } from '@gen/ai/ai';
import { mockServerStream } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

test.beforeEach(async ({ authedPage: page }) => {
  await page.getByTestId('ai-panel-toggle').click();
  await expect(page.getByTestId('ai-input')).toBeVisible();
});

test('selecting a quick action updates the input placeholder', async ({ authedPage: page }) => {
  await expect(page.getByTestId('ai-input')).toHaveAttribute('placeholder', /bullet points/);

  await pButton(page.getByTestId('ai-action-grammar')).click();
  await expect(page.getByTestId('ai-input')).toHaveAttribute('placeholder', /check grammar/);
});

test('send is disabled until the prompt is non-empty', async ({ authedPage: page }) => {
  await expect(pButton(page.getByTestId('ai-send-btn'))).toBeDisabled();
  await page.getByTestId('ai-input').fill('Write an introduction section');
  await expect(pButton(page.getByTestId('ai-send-btn'))).toBeEnabled();
});

test('DRAFT action streams output and records it in history', async ({ authedPage: page }) => {
  await mockServerStream<GenerateTextRequest, GenerateTextChunk>(page, GATEWAY_URL, {
    service: 'ai.AIService',
    method: 'GenerateTextStream',
    requestType: GenerateTextRequest,
    responseType: GenerateTextChunk,
    handler: () => [
      GenerateTextChunk.create({ delta: 'Introduction: ', done: false, promptTokens: 0, completionTokens: 0 }),
      GenerateTextChunk.create({ delta: 'this report covers...', done: true, promptTokens: 5, completionTokens: 5 }),
    ],
  });

  await page.getByTestId('ai-input').fill('Write an introduction section');
  await pButton(page.getByTestId('ai-send-btn')).click();

  await expect(page.getByTestId('ai-history-run')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('ai-history-run')).toContainText('Introduction: this report covers...');
});

test('GRAMMAR action calls CorrectGrammar and records suggestions in history', async ({ authedPage: page }) => {
  await mockServerStream<CorrectGrammarRequest, GrammarSuggestion>(page, GATEWAY_URL, {
    service: 'ai.AIService',
    method: 'CorrectGrammar',
    requestType: CorrectGrammarRequest,
    responseType: GrammarSuggestion,
    handler: () => [
      GrammarSuggestion.create({
        offset: 0,
        length: 4,
        original: 'teh',
        replacement: 'the',
        message: 'Spelling',
        ruleId: 'SPELL_1',
        context: [],
      }),
    ],
  });

  await pButton(page.getByTestId('ai-action-grammar')).click();
  await page.getByTestId('ai-input').fill('teh report is ready');
  await pButton(page.getByTestId('ai-send-btn')).click();

  await expect(page.getByTestId('ai-history-run')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('ai-history-run')).toContainText('teh');
});

test('ANALYZE action calls AnalyzeDocument and records findings in history', async ({ authedPage: page }) => {
  await mockServerStream<AnalyzeDocumentRequest, AnalysisFinding>(page, GATEWAY_URL, {
    service: 'ai.AIService',
    method: 'AnalyzeDocument',
    requestType: AnalyzeDocumentRequest,
    responseType: AnalysisFinding,
    handler: () => [
      AnalysisFinding.create({
        sectionId: 'sec-1',
        anchorText: 'intro',
        severity: 2,
        category: 1,
        message: 'Missing thesis statement',
        ordinal: 0,
      }),
    ],
  });

  await pButton(page.getByTestId('ai-action-analyze')).click();
  await page.getByTestId('ai-input').fill('full document text here');
  await pButton(page.getByTestId('ai-send-btn')).click();

  await expect(page.getByTestId('ai-history-run')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('ai-history-run')).toContainText('Missing thesis statement');
});

test('cancel stops an in-flight generation', async ({ authedPage: page }) => {
  await mockServerStream<GenerateTextRequest, GenerateTextChunk>(page, GATEWAY_URL, {
    service: 'ai.AIService',
    method: 'GenerateTextStream',
    requestType: GenerateTextRequest,
    responseType: GenerateTextChunk,
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return [GenerateTextChunk.create({ delta: 'too late', done: true, promptTokens: 0, completionTokens: 0 })];
    },
  });

  await page.getByTestId('ai-input').fill('Write a conclusion section');
  await pButton(page.getByTestId('ai-send-btn')).click();

  await expect(pButton(page.getByTestId('ai-cancel-btn'))).toBeVisible();
  await pButton(page.getByTestId('ai-cancel-btn')).click();

  await expect(page.getByTestId('ai-history-run')).toHaveCount(1);
  await expect(page.getByTestId('ai-history-run')).toContainText('Cancelled');
});

test('clears run history', async ({ authedPage: page }) => {
  await mockServerStream<GenerateTextRequest, GenerateTextChunk>(page, GATEWAY_URL, {
    service: 'ai.AIService',
    method: 'GenerateTextStream',
    requestType: GenerateTextRequest,
    responseType: GenerateTextChunk,
    handler: () => [GenerateTextChunk.create({ delta: 'done', done: true, promptTokens: 0, completionTokens: 0 })],
  });

  await page.getByTestId('ai-input').fill('Write something');
  await pButton(page.getByTestId('ai-send-btn')).click();
  await expect(page.getByTestId('ai-history-run')).toHaveCount(1, { timeout: 10_000 });

  await pButton(page.getByTestId('ai-clear-history-btn')).click();
  await expect(page.getByTestId('ai-history-run')).toHaveCount(0);
});
