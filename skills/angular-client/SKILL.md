---
name: angular-client
description: "Angular 19 client patterns for this project. Use when creating or modifying Angular components, services, routes, or auth flows in client/src/app. Covers the exact standalone-component conventions, signal-based state, gRPC-web service pattern, auth token refresh, and i18n/PrimeNG usage used across the codebase."
---

# Angular Client Patterns

Architecture and coding patterns for the Angular client (`client/src/app`). Follow these exactly when adding or modifying frontend code.

## App Layout

```
client/src/app/
  core/
    grpc/          # transport.ts (shared GrpcWebFetchTransport), token-holder.ts
    guards/        # authGuard, guestGuard
    services/      # AuthService, DocumentService, FileService, LanguageService
  features/
    <feature>/     # one dir per feature, flat components + a *.service.ts
  layout/          # LayoutComponent, header, sidebar (shell around routed features)
  shared/
    models/        # plain interfaces/enums re-exported from generated proto types
```

`app.routes.ts` is the single route table; `app.config.ts` is the single `ApplicationConfig`. There is no `NgModule` anywhere — everything is standalone.

## Standalone Components

Every component is `standalone: true` with an explicit `imports` array (PrimeNG components imported individually, e.g. `import { Button } from 'primeng/button'`, not `PrimeNGModule`). Inline `template` and `styles` are the norm for small/medium components (see `ai-tab.component.ts`); split into a `.html`/`.scss` only for large ones (see `document-editor.component.ts` pairing).

```typescript
@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [FormsModule, Button, InputTextarea, ProgressSpinner, ScrollPanel, Tag, Tooltip],
  template: `...`,
  styles: `...`,
})
export class AiTabComponent {
  readonly aiService = inject(AiService);   // inject(), not constructor DI, for services
  readonly selectedAction = signal<AIAction>(AIAction.DRAFT);
  readonly canSend = computed(() => this.inputText().trim().length > 0);
}
```

Conventions inside templates:
- `@if` / `@for` (new control-flow syntax), never `*ngIf` / `*ngFor`.
- `data-testid="..."` on interactive elements — the e2e suite (`client/e2e/`) selects by these.
- PrimeNG theming via CSS custom properties (`var(--p-surface-0)`, `var(--p-primary-color)`, etc.), not hardcoded colors.

## Signal-Based State in Services

Every stateful service is `@Injectable({ providedIn: 'root' })` with private writable signals exposed as `asReadonly()`, plus `computed()` derived views. No RxJS `BehaviorSubject` for this kind of local state — signals only.

```typescript
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly client = new DocumentServiceClient(grpcTransport);
  private readonly _documents = signal<DocumentSummary[]>([]);
  private readonly _isLoading = signal(false);

  readonly documents = this._documents.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  async list(): Promise<void> {
    this._isLoading.set(true);
    try {
      const resp = await this.auth.callWithAuthRetry(() => this.client.listDocuments({...}).response);
      this._documents.set(resp.documents.map(toSummary));
    } finally {
      this._isLoading.set(false);
    }
  }
}
```

## gRPC-Web Service Pattern

Every feature service wraps a generated `*ServiceClient` from `gen/ts` and shares the single `grpcTransport` (`core/grpc/transport.ts`):

```typescript
private readonly client = new DocumentServiceClient(grpcTransport);
```

`grpcTransport` is one `GrpcWebFetchTransport` for the whole app, with an `authInterceptor` that stamps `Authorization: Bearer <token>` from `accessToken()` (a signal in `token-holder.ts`) onto every unary/streaming call. Never construct a second transport or attach auth headers manually.

Mutating/reading calls that require auth go through `AuthService.callWithAuthRetry()`, not called directly on the client:

```typescript
const resp = await this.auth.callWithAuthRetry(() => this.client.getDocument({ id }).response);
```

`callWithAuthRetry` catches `RpcError` with code `UNAUTHENTICATED`, does one silent refresh (deduped via `refreshInFlight` so concurrent 401s trigger a single refresh), retries once, and redirects to `/auth/login` on failure. Skip it only for calls that are inherently unauthenticated (`login`, `register`, `ping`).

### Streaming RPCs

Server-streaming calls are consumed with `for await...of call.responses`, and support cancellation via `AbortController` passed as `{ abort: controller.signal }` in the call options:

```typescript
const controller = new AbortController();
const call = this.client.generateTextStream(request, { abort: controller.signal });
for await (const chunk of call.responses) {
  output += chunk.delta;
  this._runs.update((runs) => runs.map((r) => (r.id === runId ? { ...r, output } : r)));
  if (chunk.done) break;
}
```

Catch `error.name === 'AbortError'` separately from other errors to distinguish user-cancelled from failed runs.

### Proto Type Re-export Pattern

Feature services re-export the generated proto types/enums they use so components never import from `@gen/*` directly:

```typescript
export type { Document, Section };
export { SectionKind };
```

Timestamps come back as `{ seconds: bigint }` — convert explicitly (`new Date(Number(ts.seconds) * 1000)`), never pass the raw proto timestamp into a component.

## Auth & Guards

`AuthService.ready: Promise<void>` resolves once the initial silent-refresh-from-localStorage attempt on bootstrap settles. Route guards (`core/guards/auth.guard.ts`) must `await auth.ready` before checking `isAuthenticated()` — otherwise a hard refresh on an authenticated route bounces to login before the token restore finishes.

`isAuthenticated = computed(() => !!accessToken() && !!this._user())` — both the token signal and the loaded profile must be present.

## Routing

Flat route table in `app.routes.ts`, lazy nothing (all components eagerly imported — no `loadComponent`). Auth pages live under `/auth` guarded by `guestGuard`; everything else is nested under `LayoutComponent` guarded by `authGuard`:

```typescript
export const routes: Routes = [
  { path: 'auth', canActivate: [guestGuard], children: [...] },
  {
    path: '', component: LayoutComponent, canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'documents/:id', component: DocumentEditorComponent },
      ...
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

`provideRouter(routes, withComponentInputBinding())` in `app.config.ts` — route params bind to `@Input()`s automatically, don't hand-wire `ActivatedRoute.params` subscriptions for simple cases.

## i18n

`@ngx-translate/core` + `@ngx-translate/http-loader`, configured in `app.config.ts` via `provideTranslateService({ fallbackLang: 'en' })` and `provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' })`. Translation files: `client/src/assets/i18n/en.json` and `uk.json` — keep both in sync when adding a key. `LanguageService` (`core/services/language.service.ts`) owns the active-locale signal.

## Adding a New Feature

1. Add/extend the `.proto` (see `proto-workflow` skill), run `make proto`.
2. Add a `shared/models/<feature>.model.ts` with plain interfaces the components consume (map enums to friendlier unions like `AIAnalysisFinding['severity']: 'info' | 'warning' | 'error'`, don't leak raw proto enums into templates).
3. Add `features/<feature>/<feature>.service.ts`: signal-based service wrapping the generated client, auth-retried calls.
4. Add `features/<feature>/<feature>-*.component.ts`: standalone, `inject()` the service, drive template off its signals/computed.
5. Wire the route in `app.routes.ts`.
6. Add `data-testid`s for anything the e2e suite needs to select.
