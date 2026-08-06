package service

import (
	"context"
	"encoding/json"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// aiAuthor is the reserved author id for analysis findings, which ride in the
// same comment system with an `ai` badge (FR-AI-09, FR-REV-08).
const aiAuthor = "ai"

// ── Sharing (FR-REV-01..04) ──────────────────────────────────────────

func (s *DocumentService) ShareByEmail(ctx context.Context, req *pb.ShareByEmailRequest) (*pb.ShareResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}

	email := strings.ToLower(strings.TrimSpace(req.GetEmail()))
	if email == "" || !strings.Contains(email, "@") {
		return nil, grpcerr.InvalidArgument("a valid email is required",
			grpcerr.FieldViolation{Field: "email", Description: "must be a valid email address"})
	}
	role := shareRoleOrDefault(req.GetRole())

	// Email delivery is P-later: the invite carries a link token so the owner
	// can copy the URL, but it is bound to this address at first accept
	// (FR-REV-02).
	raw, hash := repository.NewLinkToken()
	share, err := s.Repos.Share.Create(ctx, doc.ID, "email", role, email, hash)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create share: %v", err)
	}
	return &pb.ShareResponse{Share: shareToProto(share, raw)}, nil
}

func (s *DocumentService) CreateShareLink(ctx context.Context, req *pb.CreateShareLinkRequest) (*pb.ShareResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}

	raw, hash := repository.NewLinkToken()
	share, err := s.Repos.Share.Create(ctx, doc.ID, "link", shareRoleOrDefault(req.GetRole()), "", hash)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create share link: %v", err)
	}
	// The raw token is returned exactly once, here: the record keeps only its
	// hash (FR-DAT-03).
	return &pb.ShareResponse{Share: shareToProto(share, raw)}, nil
}

func (s *DocumentService) RevokeShare(ctx context.Context, req *pb.RevokeShareRequest) (*pb.RevokeShareResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}
	if err := s.Repos.Share.Revoke(ctx, doc.ID, req.GetShareId()); err != nil {
		return nil, err
	}
	return &pb.RevokeShareResponse{}, nil
}

func (s *DocumentService) ListShares(ctx context.Context, req *pb.ListSharesRequest) (*pb.ListSharesResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}
	shares, err := s.Repos.Share.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list shares: %v", err)
	}
	out := make([]*pb.Share, 0, len(shares))
	for i := range shares {
		// Raw tokens are unrecoverable by design; the list shows the grant,
		// not the link.
		out = append(out, shareToProto(&shares[i], ""))
	}
	return &pb.ListSharesResponse{Shares: out}, nil
}

// AcceptShareLink claims a share for the calling account (FR-REV-03:
// reviewers must have an account — anonymous review is out of scope).
func (s *DocumentService) AcceptShareLink(ctx context.Context, req *pb.AcceptShareLinkRequest) (*pb.AcceptShareLinkResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetToken() == "" {
		return nil, grpcerr.InvalidArgument("token is required",
			grpcerr.FieldViolation{Field: "token", Description: "must not be empty"})
	}

	share, err := s.Repos.Share.FindByTokenHash(ctx, repository.HashToken(req.GetToken()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve share link: %v", err)
	}
	if share == nil {
		return nil, status.Error(codes.NotFound, "share link is invalid or has been revoked")
	}

	switch {
	case share.UserID == userID:
		// Already claimed by this account — accepting again is a no-op.
	case share.UserID == "":
		if _, err := s.Repos.Share.BindUser(ctx, share.ID, userID); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to accept share: %v", err)
		}
	default:
		// A link already claimed by someone else still works for others: each
		// accepting account gets its own revocable grant row.
		if _, err := s.Repos.Share.CloneForUser(ctx, share, userID); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to accept share: %v", err)
		}
	}

	return &pb.AcceptShareLinkResponse{
		DocumentId: share.DocumentID,
		Role:       roleFromString(share.Role),
	}, nil
}

// ── Comments (FR-REV-05..08) ─────────────────────────────────────────

func (s *DocumentService) CreateComment(ctx context.Context, req *pb.CreateCommentRequest) (*pb.CommentResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_COMMENTER)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetBody()) == "" {
		return nil, grpcerr.InvalidArgument("body is required",
			grpcerr.FieldViolation{Field: "body", Description: "must not be empty"})
	}

	author := userID
	if req.GetAiCategory() != "" {
		author = aiAuthor
	}

	comment, err := s.Repos.Comment.Create(ctx, doc.ID, req.GetSectionId(), "", author,
		req.GetAiCategory(), req.GetBody(), anchorFromProto(req.GetAnchor()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create comment: %v", err)
	}
	return &pb.CommentResponse{Comment: commentToProto(comment)}, nil
}

func (s *DocumentService) ReplyComment(ctx context.Context, req *pb.ReplyCommentRequest) (*pb.CommentResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_COMMENTER)
	if err != nil {
		return nil, err
	}

	root, err := s.Repos.Comment.GetByID(ctx, doc.ID, req.GetThreadRootId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load thread: %v", err)
	}
	if root == nil {
		return nil, status.Errorf(codes.NotFound, "comment %q not found", req.GetThreadRootId())
	}

	// A reply inherits the root's anchor so the whole thread highlights the
	// same range, and threads stay one level deep.
	reply, err := s.Repos.Comment.Create(ctx, doc.ID, root.SectionID, root.ID, userID, "", req.GetBody(), root.Anchor)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to reply: %v", err)
	}
	return &pb.CommentResponse{Comment: commentToProto(reply)}, nil
}

// ResolveComment resolves or reopens a thread — anyone with commenter+ may do
// either, and the resolver is recorded (FR-REV-07).
func (s *DocumentService) ResolveComment(ctx context.Context, req *pb.ResolveCommentRequest) (*pb.CommentResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_COMMENTER)
	if err != nil {
		return nil, err
	}

	comment, err := s.Repos.Comment.SetResolved(ctx, doc.ID, req.GetCommentId(), userID, req.GetResolved())
	if err != nil {
		return nil, err
	}
	return &pb.CommentResponse{Comment: commentToProto(comment)}, nil
}

// DeleteComment: authors delete their own comments, the owner deletes any
// (FR-REV-07).
func (s *DocumentService) DeleteComment(ctx context.Context, req *pb.DeleteCommentRequest) (*pb.DeleteCommentResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, role, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_COMMENTER)
	if err != nil {
		return nil, err
	}

	comment, err := s.Repos.Comment.GetByID(ctx, doc.ID, req.GetCommentId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load comment: %v", err)
	}
	if comment == nil {
		return nil, status.Errorf(codes.NotFound, "comment %q not found", req.GetCommentId())
	}
	if comment.Author != userID && role != pb.Role_ROLE_OWNER {
		return nil, status.Error(codes.PermissionDenied, "only the comment author or the document owner may delete it")
	}

	if err := s.Repos.Comment.Delete(ctx, doc.ID, comment.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete comment: %v", err)
	}
	return &pb.DeleteCommentResponse{}, nil
}

func (s *DocumentService) ListComments(ctx context.Context, req *pb.ListCommentsRequest) (*pb.ListCommentsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}

	comments, err := s.Repos.Comment.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list comments: %v", err)
	}

	out := make([]*pb.Comment, 0, len(comments))
	for i := range comments {
		c := &comments[i]
		if !matchesCommentFilter(c, req.GetFilter(), userID) {
			continue
		}
		out = append(out, commentToProto(c))
	}
	return &pb.ListCommentsResponse{Comments: out}, nil
}

func matchesCommentFilter(c *repository.Comment, filter pb.CommentFilter, userID string) bool {
	switch filter {
	case pb.CommentFilter_COMMENT_FILTER_OPEN:
		return c.ResolvedAt == nil
	case pb.CommentFilter_COMMENT_FILTER_RESOLVED:
		return c.ResolvedAt != nil
	case pb.CommentFilter_COMMENT_FILTER_MINE:
		return c.Author == userID
	case pb.CommentFilter_COMMENT_FILTER_AI:
		return c.Author == aiAuthor
	default:
		return true
	}
}

// ── Suggestions (FR-REV-09..12) ──────────────────────────────────────

func (s *DocumentService) ListSuggestions(ctx context.Context, req *pb.ListSuggestionsRequest) (*pb.ListSuggestionsResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}
	suggestions, err := s.Repos.Suggestion.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list suggestions: %v", err)
	}
	return &pb.ListSuggestionsResponse{Suggestions: suggestionsToProto(suggestions)}, nil
}

// RegisterSuggestions reconciles the registry with the suggestion marks the
// client just wrote into section content (FR-REV-11). Content is the source of
// truth; this index exists for listing, counters and accept/reject.
func (s *DocumentService) RegisterSuggestions(ctx context.Context, req *pb.RegisterSuggestionsRequest) (*pb.RegisterSuggestionsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_COMMENTER)
	if err != nil {
		return nil, err
	}

	kind := req.GetKind()
	if kind == "" {
		kind = "insert"
	}
	suggestions, err := s.Repos.Suggestion.Register(ctx, doc.ID, req.GetSectionId(), userID, kind, req.GetSuggestionIds())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to register suggestions: %v", err)
	}
	return &pb.RegisterSuggestionsResponse{Suggestions: suggestionsToProto(suggestions)}, nil
}

// ResolveSuggestion accepts or rejects one suggestion. The client computes the
// resulting content (accept = apply + strip marks, reject = revert) and sends
// it with the section revision, so the registry row and the content that
// backs it move together (FR-REV-10).
func (s *DocumentService) ResolveSuggestion(ctx context.Context, req *pb.ResolveSuggestionRequest) (*pb.ResolveSuggestionResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR)
	if err != nil {
		return nil, err
	}

	section, err := s.writeResolvedContent(ctx, doc.ID, req.GetSectionId(), req.GetContentJson(), int(req.GetSectionRevision()))
	if err != nil {
		return nil, err
	}

	suggestion, err := s.Repos.Suggestion.Resolve(ctx, doc.ID, req.GetSuggestionId(), resolutionStatus(req.GetAccept()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve suggestion: %v", err)
	}
	if suggestion == nil {
		return nil, status.Errorf(codes.NotFound, "pending suggestion %q not found", req.GetSuggestionId())
	}

	resp := &pb.ResolveSuggestionResponse{Suggestion: suggestionToProto(suggestion)}
	if section != nil {
		resp.Section = sectionToProto(section)
	}
	return resp, nil
}

// BulkResolveSuggestions accepts or rejects every pending suggestion in a
// section. A snapshot is taken first, since a bulk accept is the one review
// action that is hard to undo by hand (FR-REV-11, FR-EDT-10).
func (s *DocumentService) BulkResolveSuggestions(ctx context.Context, req *pb.BulkResolveSuggestionsRequest) (*pb.BulkResolveSuggestionsResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR)
	if err != nil {
		return nil, err
	}

	if _, err := s.takeSnapshot(ctx, doc, "Перед застосуванням правок", "bulk_accept"); err != nil {
		return nil, err
	}

	section, err := s.writeResolvedContent(ctx, doc.ID, req.GetSectionId(), req.GetContentJson(), int(req.GetSectionRevision()))
	if err != nil {
		return nil, err
	}

	suggestions, err := s.Repos.Suggestion.ResolveSection(ctx, doc.ID, req.GetSectionId(), resolutionStatus(req.GetAccept()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve suggestions: %v", err)
	}

	resp := &pb.BulkResolveSuggestionsResponse{Suggestions: suggestionsToProto(suggestions)}
	if section != nil {
		resp.Section = sectionToProto(section)
	}
	return resp, nil
}

// writeResolvedContent persists the post-resolution section content, honouring
// the same per-section optimistic concurrency as a normal edit (FR-EDT-09).
func (s *DocumentService) writeResolvedContent(ctx context.Context, documentID, sectionID, contentJSON string, revision int) (*repository.Section, error) {
	if sectionID == "" || contentJSON == "" {
		return nil, nil
	}

	var content map[string]any
	if err := json.Unmarshal([]byte(contentJSON), &content); err != nil {
		return nil, grpcerr.InvalidArgument("content_json is not valid JSON",
			grpcerr.FieldViolation{Field: "content_json", Description: "must be valid JSON"})
	}

	section, err := s.Repos.Section.UpdateContent(ctx, documentID, sectionID, content, revision)
	if err != nil {
		if isStaleRevision(err) {
			current := int32(0)
			if existing, gerr := s.Repos.Section.GetByID(ctx, documentID, sectionID); gerr == nil && existing != nil {
				current = int32(existing.Revision)
			}
			return nil, grpcerr.StaleRevision("section_revision is stale", current)
		}
		return nil, status.Errorf(codes.Internal, "failed to write section: %v", err)
	}
	return section, nil
}

func resolutionStatus(accept bool) string {
	if accept {
		return "accepted"
	}
	return "rejected"
}

// ── Read cursors / badges (FR-REV-14) ────────────────────────────────

func (s *DocumentService) MarkRead(ctx context.Context, req *pb.MarkReadRequest) (*pb.MarkReadResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}
	if err := s.Repos.ReadCursor.Mark(ctx, doc.ID, userID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to mark read: %v", err)
	}
	return &pb.MarkReadResponse{}, nil
}

func (s *DocumentService) GetUnreadCounts(ctx context.Context, req *pb.GetUnreadCountsRequest) (*pb.UnreadCounts, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}

	cursor, err := s.Repos.ReadCursor.Get(ctx, doc.ID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load read cursor: %v", err)
	}

	comments, err := s.Repos.Comment.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list comments: %v", err)
	}
	suggestions, err := s.Repos.Suggestion.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list suggestions: %v", err)
	}

	counts := &pb.UnreadCounts{DocumentId: doc.ID}
	for i := range comments {
		// Your own activity never counts as unread.
		if comments[i].Author == userID {
			continue
		}
		if cursor == nil || comments[i].CreatedAt.After(cursor.LastSeenAt) {
			counts.Comments++
		}
	}
	for i := range suggestions {
		if suggestions[i].AuthorID == userID || suggestions[i].Status != "pending" {
			continue
		}
		if cursor == nil || suggestions[i].CreatedAt.After(cursor.LastSeenAt) {
			counts.Suggestions++
		}
	}
	return counts, nil
}

// ── Proto conversion ─────────────────────────────────────────────────

func shareRoleOrDefault(role pb.Role) string {
	// The supervisor default is commenter (FR-REV-01); owner is never
	// grantable through a share.
	if role == pb.Role_ROLE_UNSPECIFIED || role == pb.Role_ROLE_OWNER {
		return "commenter"
	}
	return roleToString(role)
}

func shareToProto(share *repository.Share, rawToken string) *pb.Share {
	return &pb.Share{
		Id:         share.ID,
		DocumentId: share.DocumentID,
		Kind:       share.Kind,
		Role:       roleFromString(share.Role),
		UserId:     share.UserID,
		Email:      share.Email,
		LinkToken:  rawToken,
		Revoked:    share.RevokedAt != nil,
		CreatedAt:  timestamppb.New(share.CreatedAt),
	}
}

func anchorFromProto(anchor *pb.CommentAnchor) repository.CommentAnchor {
	if anchor == nil {
		return repository.CommentAnchor{}
	}
	return repository.CommentAnchor{
		BlockID:      anchor.GetBlockId(),
		OffsetFrom:   int(anchor.GetOffsetFrom()),
		OffsetTo:     int(anchor.GetOffsetTo()),
		TextSnapshot: anchor.GetTextSnapshot(),
	}
}

func commentToProto(c *repository.Comment) *pb.Comment {
	out := &pb.Comment{
		Id:           c.ID,
		DocumentId:   c.DocumentID,
		SectionId:    c.SectionID,
		ThreadRootId: c.ThreadRootID,
		Author:       c.Author,
		AiCategory:   c.AICategory,
		Anchor: &pb.CommentAnchor{
			BlockId:      c.Anchor.BlockID,
			OffsetFrom:   int32(c.Anchor.OffsetFrom),
			OffsetTo:     int32(c.Anchor.OffsetTo),
			TextSnapshot: c.Anchor.TextSnapshot,
		},
		Orphaned:   c.Orphaned,
		Body:       c.Body,
		ResolvedBy: c.ResolvedBy,
		CreatedAt:  timestamppb.New(c.CreatedAt),
	}
	if c.ResolvedAt != nil {
		out.ResolvedAt = timestamppb.New(*c.ResolvedAt)
	}
	return out
}

func suggestionToProto(s *repository.Suggestion) *pb.Suggestion {
	out := &pb.Suggestion{
		Id:           s.ID,
		DocumentId:   s.DocumentID,
		SectionId:    s.SectionID,
		SuggestionId: s.SuggestionID,
		AuthorId:     s.AuthorID,
		Kind:         s.Kind,
		Status:       s.Status,
		CreatedAt:    timestamppb.New(s.CreatedAt),
	}
	if s.ResolvedAt != nil {
		out.ResolvedAt = timestamppb.New(*s.ResolvedAt)
	}
	return out
}

func suggestionsToProto(list []repository.Suggestion) []*pb.Suggestion {
	out := make([]*pb.Suggestion, 0, len(list))
	for i := range list {
		out = append(out, suggestionToProto(&list[i]))
	}
	return out
}
