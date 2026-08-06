package service

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// Authorization lives in the service, not the gateway: the gateway
// authenticates, services authorize (FR-API-02, NFR-10).
//
// The proto enum numbers roles from most to least privileged
// (owner=1 … viewer=4), so "at least role X" is `role <= X`.
func atLeast(role, minimum pb.Role) bool {
	return role != pb.Role_ROLE_UNSPECIFIED && role <= minimum
}

func roleFromString(role string) pb.Role {
	switch role {
	case "owner":
		return pb.Role_ROLE_OWNER
	case "editor":
		return pb.Role_ROLE_EDITOR
	case "commenter":
		return pb.Role_ROLE_COMMENTER
	case "viewer":
		return pb.Role_ROLE_VIEWER
	}
	return pb.Role_ROLE_UNSPECIFIED
}

func roleToString(role pb.Role) string {
	switch role {
	case pb.Role_ROLE_OWNER:
		return "owner"
	case pb.Role_ROLE_EDITOR:
		return "editor"
	case pb.Role_ROLE_COMMENTER:
		return "commenter"
	case pb.Role_ROLE_VIEWER:
		return "viewer"
	}
	return ""
}

// resolveRole returns the caller's effective role on a document: owner when
// they own it, otherwise the role of a live share bound to them.
func (s *DocumentService) resolveRole(ctx context.Context, doc *repository.Document, userID string) (pb.Role, error) {
	if doc.OwnerID == userID {
		return pb.Role_ROLE_OWNER, nil
	}
	share, err := s.Repos.Share.FindForUserAndDocument(ctx, doc.ID, userID)
	if err != nil {
		return pb.Role_ROLE_UNSPECIFIED, status.Errorf(codes.Internal, "failed to resolve access: %v", err)
	}
	if share == nil {
		return pb.Role_ROLE_UNSPECIFIED, nil
	}
	return roleFromString(share.Role), nil
}

// requireAccess loads a document and checks the caller holds at least
// `minimum`. A user with no access at all gets NOT_FOUND rather than
// PERMISSION_DENIED, so document ids can't be probed for existence (NFR-10).
func (s *DocumentService) requireAccess(ctx context.Context, documentID string, minimum pb.Role) (*repository.Document, pb.Role, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, pb.Role_ROLE_UNSPECIFIED, err
	}

	doc, err := s.Repos.Document.GetByID(ctx, documentID)
	if err != nil {
		return nil, pb.Role_ROLE_UNSPECIFIED, status.Errorf(codes.Internal, "failed to load document: %v", err)
	}
	if doc == nil {
		return nil, pb.Role_ROLE_UNSPECIFIED, status.Errorf(codes.NotFound, "document %q not found", documentID)
	}

	role, err := s.resolveRole(ctx, doc, userID)
	if err != nil {
		return nil, pb.Role_ROLE_UNSPECIFIED, err
	}
	if role == pb.Role_ROLE_UNSPECIFIED {
		return nil, role, status.Errorf(codes.NotFound, "document %q not found", documentID)
	}
	if !atLeast(role, minimum) {
		return nil, role, status.Errorf(codes.PermissionDenied, "role %s is insufficient for this operation", roleToString(role))
	}
	return doc, role, nil
}
