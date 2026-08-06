package service

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// snapshotRetention caps how many snapshots a document keeps; FR-EDT-10's
// cadence rules (manual, pre-export, pre-bulk-accept, hourly) are what bound
// creation, this bounds accumulated storage since snapshots are full copies
// (FR-DAT-04).
const snapshotRetention = 50

func (s *DocumentService) CreateSnapshot(ctx context.Context, req *pb.CreateSnapshotRequest) (*pb.SnapshotResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID)
	if err != nil {
		return nil, err
	}

	snapshot, err := s.takeSnapshot(ctx, doc, req.GetName(), "manual")
	if err != nil {
		return nil, err
	}
	return &pb.SnapshotResponse{Snapshot: snapshotToProto(snapshot)}, nil
}

func (s *DocumentService) ListSnapshots(ctx context.Context, req *pb.ListSnapshotsRequest) (*pb.ListSnapshotsResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID); err != nil {
		return nil, err
	}

	snapshots, err := s.Repos.Snapshot.ListByDocument(ctx, req.GetDocumentId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list snapshots: %v", err)
	}
	out := make([]*pb.Snapshot, 0, len(snapshots))
	for i := range snapshots {
		out = append(out, snapshotToProto(&snapshots[i]))
	}
	return &pb.ListSnapshotsResponse{Snapshots: out}, nil
}

// RestoreSnapshot replaces current content with a stored snapshot. Per
// FR-EDT-10 the current state is snapshotted first, so a restore is itself
// undoable.
func (s *DocumentService) RestoreSnapshot(ctx context.Context, req *pb.RestoreSnapshotRequest) (*pb.DocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID)
	if err != nil {
		return nil, err
	}

	snapshot, err := s.Repos.Snapshot.GetByID(ctx, doc.ID, req.GetSnapshotId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load snapshot: %v", err)
	}
	if snapshot == nil {
		return nil, status.Errorf(codes.NotFound, "snapshot %q not found", req.GetSnapshotId())
	}

	if _, err := s.takeSnapshot(ctx, doc, "Перед відновленням", "auto"); err != nil {
		return nil, err
	}

	if err := s.applySnapshot(ctx, doc, snapshot); err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, &pb.GetDocumentRequest{Id: doc.ID})
}

// takeSnapshot copies the document, its sections and its sources into one
// record (FR-DAT-04: full copies, not diffs).
func (s *DocumentService) takeSnapshot(ctx context.Context, doc *repository.Document, name, trigger string) (*repository.Snapshot, error) {
	sections, err := s.Repos.Section.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sections: %v", err)
	}
	sources, err := s.Repos.Source.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sources: %v", err)
	}

	sectionData := make([]any, 0, len(sections))
	for i := range sections {
		sec := &sections[i]
		sectionData = append(sectionData, map[string]any{
			"id":                  sec.ID,
			"template_section_id": sec.TemplateSectionID,
			"title":               sec.Title,
			"kind":                sec.Kind,
			"order_index":         sec.OrderIndex,
			"required":            sec.Required,
			"content":             sec.Content,
		})
	}
	sourceData := make([]any, 0, len(sources))
	for i := range sources {
		src := &sources[i]
		sourceData = append(sourceData, map[string]any{
			"id":                       src.ID,
			"csl":                      src.CSL,
			"language":                 src.Language,
			"raw_input":                src.RawInput,
			"fill_status":              src.FillStatus,
			"access_date":              src.AccessDate,
			"include_uncited_override": src.IncludeUncitedOverride,
		})
	}

	metadata := make(map[string]any, len(doc.Metadata))
	for k, v := range doc.Metadata {
		metadata[k] = v
	}

	snapshot, err := s.Repos.Snapshot.Create(ctx, doc.ID, name, trigger, map[string]any{
		"title":    doc.Title,
		"metadata": metadata,
		"settings": map[string]any{
			"citation_style":     doc.Settings.CitationStyle,
			"numbering_mode":     doc.Settings.NumberingMode,
			"include_uncited":    doc.Settings.IncludeUncited,
			"table_continuation": doc.Settings.TableContinuation,
		},
		"sections": sectionData,
		"sources":  sourceData,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create snapshot: %v", err)
	}

	s.pruneSnapshots(ctx, doc.ID)
	return snapshot, nil
}

func (s *DocumentService) pruneSnapshots(ctx context.Context, documentID string) {
	existing, err := s.Repos.Snapshot.ListByDocument(ctx, documentID)
	if err != nil || len(existing) <= snapshotRetention {
		return
	}
	for i := snapshotRetention; i < len(existing); i++ {
		_ = s.Repos.Snapshot.Delete(ctx, documentID, existing[i].ID)
	}
}

// applySnapshot rewrites sections and sources from stored data. Section
// records are recreated rather than patched: a snapshot may contain sections
// that were since deleted, and ids must survive so comment anchors and
// cross-references keep resolving.
func (s *DocumentService) applySnapshot(ctx context.Context, doc *repository.Document, snapshot *repository.Snapshot) error {
	data := snapshot.Data

	if title, ok := data["title"].(string); ok && title != "" {
		if _, err := s.Repos.Document.Rename(ctx, doc.ID, doc.OwnerID, title); err != nil {
			return err
		}
	}

	if metadata, ok := data["metadata"].(map[string]any); ok {
		values := make(map[string]string, len(metadata))
		for k, v := range metadata {
			if str, ok := v.(string); ok {
				values[k] = str
			}
		}
		current, err := s.Repos.Document.GetByID(ctx, doc.ID)
		if err != nil {
			return status.Errorf(codes.Internal, "failed to reload document: %v", err)
		}
		if _, err := s.Repos.Document.UpdateMetadata(ctx, doc.ID, doc.OwnerID, values, current.MetadataRevision); err != nil {
			return status.Errorf(codes.Internal, "failed to restore metadata: %v", err)
		}
	}

	if err := s.Repos.Section.DeleteByDocument(ctx, doc.ID); err != nil {
		return status.Errorf(codes.Internal, "failed to clear sections: %v", err)
	}
	if sections, ok := data["sections"].([]any); ok {
		for _, raw := range sections {
			sec, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			content, _ := sec["content"].(map[string]any)
			if _, err := s.Repos.Section.RestoreFromSnapshot(ctx, doc.ID,
				stringOf(sec["id"]), stringOf(sec["template_section_id"]), stringOf(sec["title"]),
				stringOf(sec["kind"]), intOf(sec["order_index"]), boolOf(sec["required"]), content); err != nil {
				return status.Errorf(codes.Internal, "failed to restore section: %v", err)
			}
		}
	}

	if err := s.Repos.Source.DeleteByDocument(ctx, doc.ID); err != nil {
		return status.Errorf(codes.Internal, "failed to clear sources: %v", err)
	}
	if sources, ok := data["sources"].([]any); ok {
		for _, raw := range sources {
			src, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			csl, _ := src["csl"].(map[string]any)
			if _, err := s.Repos.Source.RestoreFromSnapshot(ctx, doc.ID, stringOf(src["id"]), csl,
				stringOf(src["language"]), stringOf(src["raw_input"]), stringOf(src["fill_status"]),
				stringOf(src["access_date"]), boolOf(src["include_uncited_override"])); err != nil {
				return status.Errorf(codes.Internal, "failed to restore source: %v", err)
			}
		}
	}
	return nil
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}

func boolOf(v any) bool {
	b, _ := v.(bool)
	return b
}

// intOf accepts every numeric shape the CBOR driver may hand back for a
// stored integer.
func intOf(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case uint64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func snapshotToProto(snapshot *repository.Snapshot) *pb.Snapshot {
	return &pb.Snapshot{
		Id:         snapshot.ID,
		DocumentId: snapshot.DocumentID,
		Name:       snapshot.Name,
		Trigger:    snapshot.Trigger,
		CreatedAt:  timestamppb.New(snapshot.CreatedAt),
	}
}
