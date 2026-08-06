package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	shareTable      = "share"
	commentTable    = "comment"
	suggestionTable = "suggestion_registry"
	readCursorTable = "read_cursor"
)

// ── Shares ───────────────────────────────────────────────────────────

type Share struct {
	ID         string          `json:"-"`
	RawID      models.RecordID `json:"id"`
	DocumentID string          `json:"document_id"`
	// email | link
	Kind string `json:"kind"`
	// viewer | commenter | editor
	Role string `json:"role"`
	// Bound on accept (FR-REV-02); empty until then.
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	// FR-DAT-03: only the hash is stored — the raw token exists solely in the
	// URL handed to the reviewer.
	LinkTokenHash string     `json:"link_token_hash"`
	RevokedAt     *time.Time `json:"revoked_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

func (s *Share) hydrateID() { s.ID = idString(s.RawID) }

type ShareRepository struct {
	db *surrealdb.DB
}

func NewShareRepository(db *surrealdb.DB) *ShareRepository {
	return &ShareRepository{db: db}
}

// NewLinkToken returns (raw, hash). The raw token is ≥128 bits of entropy
// (NFR-08) and is never persisted.
func NewLinkToken() (string, string) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failing means the platform RNG is broken; a share link
		// with predictable entropy is worse than no link, so panic rather
		// than degrade silently.
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	return raw, HashToken(raw)
}

func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (r *ShareRepository) Create(ctx context.Context, documentID, kind, role, email, tokenHash string) (*Share, error) {
	id := uuid.New().String()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, kind: $kind, role: $role, user_id: '', email: $email,
		link_token_hash: $token_hash, revoked_at: NONE, created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"table": shareTable, "id": id, "document_id": documentID, "kind": kind,
		"role": role, "email": email, "token_hash": tokenHash, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("create share: %w", err)
	}
	share, err := single(res)
	if err != nil {
		return nil, err
	}
	if share == nil {
		return nil, status.Error(codes.Internal, "create share: no row returned")
	}
	return share, nil
}

func (r *ShareRepository) ListByDocument(ctx context.Context, documentID string) ([]Share, error) {
	const q = `SELECT * FROM share WHERE document_id = $document_id ORDER BY created_at ASC`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list shares: %w", err)
	}
	return rows(res)
}

// ListForUser returns the live shares that grant this user access, used both
// for the "shared with me" list and for per-RPC authorization.
func (r *ShareRepository) ListForUser(ctx context.Context, userID string) ([]Share, error) {
	const q = `SELECT * FROM share WHERE user_id = $user_id AND revoked_at IS NONE`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{"user_id": userID})
	if err != nil {
		return nil, fmt.Errorf("list shares for user: %w", err)
	}
	return rows(res)
}

// FindForUserAndDocument resolves one user's access to one document.
func (r *ShareRepository) FindForUserAndDocument(ctx context.Context, documentID, userID string) (*Share, error) {
	const q = `SELECT * FROM share WHERE document_id = $document_id AND user_id = $user_id
		AND revoked_at IS NONE LIMIT 1`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"document_id": documentID, "user_id": userID,
	})
	if err != nil {
		return nil, fmt.Errorf("find share: %w", err)
	}
	return single(res)
}

func (r *ShareRepository) FindByTokenHash(ctx context.Context, tokenHash string) (*Share, error) {
	const q = `SELECT * FROM share WHERE link_token_hash = $token_hash AND revoked_at IS NONE LIMIT 1`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{"token_hash": tokenHash})
	if err != nil {
		return nil, fmt.Errorf("find share by token: %w", err)
	}
	return single(res)
}

// FindPendingEmailInvite finds an unaccepted email invite for this address, so
// accepting a link binds the invite that was actually meant for the user
// (FR-REV-02).
func (r *ShareRepository) FindPendingEmailInvite(ctx context.Context, documentID, email string) (*Share, error) {
	const q = `SELECT * FROM share WHERE document_id = $document_id AND email = $email
		AND user_id = '' AND revoked_at IS NONE LIMIT 1`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"document_id": documentID, "email": email,
	})
	if err != nil {
		return nil, fmt.Errorf("find email invite: %w", err)
	}
	return single(res)
}

// BindUser attaches an account to a share on first accept. A link share is
// cloned per accepting user so one link can grant several people access while
// each keeps its own revocable row.
func (r *ShareRepository) BindUser(ctx context.Context, shareID, userID string) (*Share, error) {
	const q = `UPDATE type::record($table, $id) SET user_id = $user_id WHERE user_id = ''`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"table": shareTable, "id": shareID, "user_id": userID,
	})
	if err != nil {
		return nil, fmt.Errorf("bind share: %w", err)
	}
	return single(res)
}

// CloneForUser records an additional grant from an already-claimed link share.
func (r *ShareRepository) CloneForUser(ctx context.Context, source *Share, userID string) (*Share, error) {
	id := uuid.New().String()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, kind: 'link', role: $role, user_id: $user_id, email: '',
		link_token_hash: $token_hash, revoked_at: NONE, created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"table": shareTable, "id": id, "document_id": source.DocumentID, "role": source.Role,
		"user_id": userID, "token_hash": source.LinkTokenHash, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("clone share: %w", err)
	}
	return single(res)
}

func (r *ShareRepository) Revoke(ctx context.Context, documentID, shareID string) error {
	const q = `UPDATE type::record($table, $id) SET revoked_at = $now WHERE document_id = $document_id`
	res, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{
		"table": shareTable, "id": shareID, "document_id": documentID, "now": time.Now(),
	})
	if err != nil {
		return fmt.Errorf("revoke share: %w", err)
	}
	revoked, err := single(res)
	if err != nil {
		return err
	}
	if revoked == nil {
		return status.Errorf(codes.NotFound, "share %q not found", shareID)
	}
	return nil
}

func (r *ShareRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE share WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Share](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete shares of document: %w", err)
	}
	return nil
}

// ── Comments ─────────────────────────────────────────────────────────

type CommentAnchor struct {
	BlockID      string `json:"block_id"`
	OffsetFrom   int    `json:"offset_from"`
	OffsetTo     int    `json:"offset_to"`
	TextSnapshot string `json:"text_snapshot"`
}

type Comment struct {
	ID           string          `json:"-"`
	RawID        models.RecordID `json:"id"`
	DocumentID   string          `json:"document_id"`
	SectionID    string          `json:"section_id"`
	ThreadRootID string          `json:"thread_root_id"`
	// User id, or "ai" for analysis findings (FR-AI-09).
	Author     string        `json:"author"`
	AICategory string        `json:"ai_category"`
	Anchor     CommentAnchor `json:"anchor"`
	Orphaned   bool          `json:"orphaned"`
	Body       string        `json:"body"`
	ResolvedBy string        `json:"resolved_by"`
	ResolvedAt *time.Time    `json:"resolved_at"`
	CreatedAt  time.Time     `json:"created_at"`
}

func (c *Comment) hydrateID() { c.ID = idString(c.RawID) }

type CommentRepository struct {
	db *surrealdb.DB
}

func NewCommentRepository(db *surrealdb.DB) *CommentRepository {
	return &CommentRepository{db: db}
}

func (r *CommentRepository) Create(ctx context.Context, documentID, sectionID, threadRootID, author, aiCategory, body string, anchor CommentAnchor) (*Comment, error) {
	id := uuid.New().String()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, section_id: $section_id, thread_root_id: $thread_root_id,
		author: $author, ai_category: $ai_category, anchor: $anchor, orphaned: false,
		body: $body, resolved_by: '', resolved_at: NONE, created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{
		"table": commentTable, "id": id, "document_id": documentID, "section_id": sectionID,
		"thread_root_id": threadRootID, "author": author, "ai_category": aiCategory,
		"anchor": anchor, "body": body, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("create comment: %w", err)
	}
	comment, err := single(res)
	if err != nil {
		return nil, err
	}
	if comment == nil {
		return nil, status.Error(codes.Internal, "create comment: no row returned")
	}
	return comment, nil
}

func (r *CommentRepository) GetByID(ctx context.Context, documentID, id string) (*Comment, error) {
	const q = `SELECT * FROM type::record($table, $id) WHERE document_id = $document_id`
	res, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{
		"table": commentTable, "id": id, "document_id": documentID,
	})
	if err != nil {
		return nil, fmt.Errorf("get comment: %w", err)
	}
	return single(res)
}

func (r *CommentRepository) ListByDocument(ctx context.Context, documentID string) ([]Comment, error) {
	const q = `SELECT * FROM comment WHERE document_id = $document_id ORDER BY created_at ASC`
	res, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	return rows(res)
}

// SetResolved resolves or reopens a thread (FR-REV-07).
func (r *CommentRepository) SetResolved(ctx context.Context, documentID, id, resolvedBy string, resolved bool) (*Comment, error) {
	q := `UPDATE type::record($table, $id) SET resolved_at = $now, resolved_by = $by WHERE document_id = $document_id`
	args := map[string]any{
		"table": commentTable, "id": id, "document_id": documentID,
		"now": time.Now(), "by": resolvedBy,
	}
	if !resolved {
		q = `UPDATE type::record($table, $id) SET resolved_at = NONE, resolved_by = '' WHERE document_id = $document_id`
		delete(args, "now")
		delete(args, "by")
	}

	res, err := surrealdb.Query[[]Comment](ctx, r.db, q, args)
	if err != nil {
		return nil, fmt.Errorf("resolve comment: %w", err)
	}
	updated, err := single(res)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, status.Errorf(codes.NotFound, "comment %q not found", id)
	}
	return updated, nil
}

// SetOrphanedByBlocks marks comments whose anchor block no longer exists in
// the section, and un-marks the ones whose block came back (an undo). Never
// deletes: an orphaned comment lists at section level (FR-REV-06).
func (r *CommentRepository) SetOrphanedByBlocks(ctx context.Context, documentID, sectionID string, liveBlockIDs []string) error {
	const q = `UPDATE comment SET orphaned = !array::contains($block_ids, anchor.block_id)
		WHERE document_id = $document_id AND section_id = $section_id`
	if _, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{
		"document_id": documentID, "section_id": sectionID, "block_ids": liveBlockIDs,
	}); err != nil {
		return fmt.Errorf("update comment anchors: %w", err)
	}
	return nil
}

// Delete removes a comment and, when it is a thread root, its replies.
func (r *CommentRepository) Delete(ctx context.Context, documentID, id string) error {
	const q = `DELETE comment WHERE document_id = $document_id AND (id = type::record($table, $id) OR thread_root_id = $id)`
	if _, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{
		"table": commentTable, "id": id, "document_id": documentID,
	}); err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	return nil
}

func (r *CommentRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE comment WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Comment](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete comments of document: %w", err)
	}
	return nil
}

// ── Suggestion registry ──────────────────────────────────────────────

type Suggestion struct {
	ID           string          `json:"-"`
	RawID        models.RecordID `json:"id"`
	DocumentID   string          `json:"document_id"`
	SectionID    string          `json:"section_id"`
	SuggestionID string          `json:"suggestion_id"`
	AuthorID     string          `json:"author_id"`
	// insert | delete | format
	Kind string `json:"kind"`
	// pending | accepted | rejected
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	ResolvedAt *time.Time `json:"resolved_at"`
}

func (s *Suggestion) hydrateID() { s.ID = idString(s.RawID) }

type SuggestionRepository struct {
	db *surrealdb.DB
}

func NewSuggestionRepository(db *surrealdb.DB) *SuggestionRepository {
	return &SuggestionRepository{db: db}
}

func (r *SuggestionRepository) ListByDocument(ctx context.Context, documentID string) ([]Suggestion, error) {
	const q = `SELECT * FROM suggestion_registry WHERE document_id = $document_id ORDER BY created_at ASC`
	res, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list suggestions: %w", err)
	}
	return rows(res)
}

func (r *SuggestionRepository) FindPending(ctx context.Context, documentID, suggestionID string) (*Suggestion, error) {
	const q = `SELECT * FROM suggestion_registry WHERE document_id = $document_id
		AND suggestion_id = $suggestion_id AND status = 'pending' LIMIT 1`
	res, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{
		"document_id": documentID, "suggestion_id": suggestionID,
	})
	if err != nil {
		return nil, fmt.Errorf("find suggestion: %w", err)
	}
	return single(res)
}

// Register inserts registry rows for suggestion ids that aren't tracked yet.
// The marks in section content are the source of truth (FR-REV-11); this is
// the index used for listing, counters and accept/reject.
func (r *SuggestionRepository) Register(ctx context.Context, documentID, sectionID, authorID, kind string, suggestionIDs []string) ([]Suggestion, error) {
	for _, sid := range suggestionIDs {
		existing, err := r.FindPending(ctx, documentID, sid)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			continue
		}

		const q = `CREATE type::record($table, $id) CONTENT {
			document_id: $document_id, section_id: $section_id, suggestion_id: $suggestion_id,
			author_id: $author_id, kind: $kind, status: 'pending', created_at: $created_at,
			resolved_at: NONE
		}`
		if _, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{
			"table": suggestionTable, "id": uuid.New().String(), "document_id": documentID,
			"section_id": sectionID, "suggestion_id": sid, "author_id": authorID,
			"kind": kind, "created_at": time.Now(),
		}); err != nil {
			return nil, fmt.Errorf("register suggestion: %w", err)
		}
	}
	return r.ListByDocument(ctx, documentID)
}

func (r *SuggestionRepository) Resolve(ctx context.Context, documentID, suggestionID, status string) (*Suggestion, error) {
	const q = `UPDATE suggestion_registry SET status = $status, resolved_at = $now
		WHERE document_id = $document_id AND suggestion_id = $suggestion_id AND status = 'pending'`
	res, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{
		"document_id": documentID, "suggestion_id": suggestionID, "status": status, "now": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("resolve suggestion: %w", err)
	}
	return single(res)
}

// ResolveSection resolves every pending suggestion in one section (bulk
// accept/reject, FR-REV-10).
func (r *SuggestionRepository) ResolveSection(ctx context.Context, documentID, sectionID, status string) ([]Suggestion, error) {
	const q = `UPDATE suggestion_registry SET status = $status, resolved_at = $now
		WHERE document_id = $document_id AND section_id = $section_id AND status = 'pending'`
	if _, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{
		"document_id": documentID, "section_id": sectionID, "status": status, "now": time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("bulk resolve suggestions: %w", err)
	}
	return r.ListByDocument(ctx, documentID)
}

func (r *SuggestionRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE suggestion_registry WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Suggestion](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete suggestions of document: %w", err)
	}
	return nil
}

// ── Read cursors (FR-REV-14) ─────────────────────────────────────────

type ReadCursor struct {
	ID         string          `json:"-"`
	RawID      models.RecordID `json:"id"`
	DocumentID string          `json:"document_id"`
	UserID     string          `json:"user_id"`
	LastSeenAt time.Time       `json:"last_seen_at"`
}

func (c *ReadCursor) hydrateID() { c.ID = idString(c.RawID) }

type ReadCursorRepository struct {
	db *surrealdb.DB
}

func NewReadCursorRepository(db *surrealdb.DB) *ReadCursorRepository {
	return &ReadCursorRepository{db: db}
}

// Get returns the user's cursor for a document, or nil if they never opened it.
func (r *ReadCursorRepository) Get(ctx context.Context, documentID, userID string) (*ReadCursor, error) {
	const q = `SELECT * FROM read_cursor WHERE document_id = $document_id AND user_id = $user_id LIMIT 1`
	res, err := surrealdb.Query[[]ReadCursor](ctx, r.db, q, map[string]any{
		"document_id": documentID, "user_id": userID,
	})
	if err != nil {
		return nil, fmt.Errorf("get read cursor: %w", err)
	}
	return single(res)
}

func (r *ReadCursorRepository) Mark(ctx context.Context, documentID, userID string) error {
	existing, err := r.Get(ctx, documentID, userID)
	if err != nil {
		return err
	}

	now := time.Now()
	if existing != nil {
		const q = `UPDATE type::record($table, $id) SET last_seen_at = $now`
		if _, err := surrealdb.Query[[]ReadCursor](ctx, r.db, q, map[string]any{
			"table": readCursorTable, "id": existing.ID, "now": now,
		}); err != nil {
			return fmt.Errorf("update read cursor: %w", err)
		}
		return nil
	}

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, user_id: $user_id, last_seen_at: $now
	}`
	if _, err := surrealdb.Query[[]ReadCursor](ctx, r.db, q, map[string]any{
		"table": readCursorTable, "id": uuid.New().String(),
		"document_id": documentID, "user_id": userID, "now": now,
	}); err != nil {
		return fmt.Errorf("create read cursor: %w", err)
	}
	return nil
}

func (r *ReadCursorRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE read_cursor WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]ReadCursor](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete read cursors of document: %w", err)
	}
	return nil
}
