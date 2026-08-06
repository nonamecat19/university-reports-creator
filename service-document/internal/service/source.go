package service

import (
	"context"
	"encoding/json"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	renderpb "github.com/nnc/university-reports-creator/gen/go/render"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// AddSource stores a confirmed bibliography entry (FR-BIB-01..03). Resolution
// results always pass through the client's form first — nothing is saved
// blind (FR-BIB-04).
func (s *DocumentService) AddSource(ctx context.Context, req *pb.AddSourceRequest) (*pb.SourceResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}

	csl, err := decodeCSL(req.GetCslJson())
	if err != nil {
		return nil, err
	}

	source, err := s.Repos.Source.Add(ctx, req.GetDocumentId(), csl,
		defaultString(req.GetLanguage(), "uk"), req.GetRawInput(),
		defaultString(req.GetFillStatus(), "manual"), req.GetAccessDate())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add source: %v", err)
	}
	return &pb.SourceResponse{Source: sourceToProto(source)}, nil
}

func (s *DocumentService) UpdateSource(ctx context.Context, req *pb.UpdateSourceRequest) (*pb.SourceResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}

	csl, err := decodeCSL(req.GetCslJson())
	if err != nil {
		return nil, err
	}

	source, err := s.Repos.Source.Update(ctx, req.GetDocumentId(), req.GetSourceId(), csl,
		defaultString(req.GetLanguage(), "uk"), defaultString(req.GetFillStatus(), "manual"),
		req.GetAccessDate(), req.GetIncludeUncitedOverride())
	if err != nil {
		return nil, err
	}
	return &pb.SourceResponse{Source: sourceToProto(source)}, nil
}

func (s *DocumentService) DeleteSource(ctx context.Context, req *pb.DeleteSourceRequest) (*pb.DeleteSourceResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}
	// Citations pointing at the deleted source become orphans rather than
	// being scrubbed from content: the editor flags them and export blocks
	// until the student resolves each one (FR-BIB-07).
	if err := s.Repos.Source.Delete(ctx, req.GetDocumentId(), req.GetSourceId()); err != nil {
		return nil, err
	}
	return &pb.DeleteSourceResponse{}, nil
}

func (s *DocumentService) ListSources(ctx context.Context, req *pb.ListSourcesRequest) (*pb.ListSourcesResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER); err != nil {
		return nil, err
	}

	sources, err := s.Repos.Source.ListByDocument(ctx, req.GetDocumentId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sources: %v", err)
	}
	out := make([]*pb.Source, 0, len(sources))
	for i := range sources {
		out = append(out, sourceToProto(&sources[i]))
	}
	return &pb.ListSourcesResponse{Sources: out}, nil
}

// ResolveSource proxies DOI/ISBN/URL lookups to service-render (FR-BIB-04).
// Freeform reference strings are not resolvable here: they belong to
// service-ai's ParseReference (FR-AI-13), which the client calls directly
// through the gateway — service-document may only call service-render
// (FR-ARC-07). The response says so via resolver="none".
func (s *DocumentService) ResolveSource(ctx context.Context, req *pb.ResolveSourceRequest) (*pb.ResolveSourceResponse, error) {
	if _, err := requireUserID(ctx); err != nil {
		return nil, err
	}
	if req.GetInput() == "" {
		return nil, grpcerr.InvalidArgument("input is required",
			grpcerr.FieldViolation{Field: "input", Description: "must not be empty"})
	}

	resp, err := s.Clients.Render.ResolveSource(ctx, &renderpb.ResolveSourceRequest{Input: req.GetInput()})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "source resolution failed: %v", err)
	}
	return &pb.ResolveSourceResponse{
		CslJson:    resp.GetCslJson(),
		Resolver:   resp.GetResolver(),
		FillStatus: resp.GetFillStatus(),
		Warning:    resp.GetWarning(),
	}, nil
}

// GetBibliography renders the reference list for the editor preview
// (FR-BIB-10) through the same RenderService pass the export uses, so preview
// and exported docx can never disagree.
func (s *DocumentService) GetBibliography(ctx context.Context, req *pb.GetBibliographyRequest) (*pb.GetBibliographyResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}

	ordered, orphans, err := s.bibliographyInput(ctx, doc)
	if err != nil {
		return nil, err
	}

	resp, err := s.Clients.Render.RenderBibliography(ctx, &renderpb.RenderBibliographyRequest{
		StyleId:        defaultString(doc.Settings.CitationStyle, "dstu-8302-2015"),
		SourcesCslJson: ordered,
		NumberingMode:  defaultString(doc.Settings.NumberingMode, "by_order"),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "bibliography rendering failed: %v", err)
	}

	entries := make([]*pb.BibliographyEntry, 0, len(resp.GetEntries()))
	for _, e := range resp.GetEntries() {
		entries = append(entries, &pb.BibliographyEntry{
			Number: e.GetNumber(), SourceId: e.GetSourceId(), Formatted: e.GetFormatted(),
		})
	}
	return &pb.GetBibliographyResponse{Entries: entries, OrphanedCitationIds: orphans}, nil
}

// bibliographyInput returns the document's sources as CSL-JSON strings in
// citation order, plus the ids cited in content that no longer have a source.
//
// Ordering happens here rather than in service-render because only this
// service can see section content: `by_order` numbering (FR-BIB-06) means
// "order of first citation occurrence", and the renderer receives sources
// already in that order.
func (s *DocumentService) bibliographyInput(ctx context.Context, doc *repository.Document) ([]string, []string, error) {
	sources, err := s.Repos.Source.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to list sources: %v", err)
	}
	sections, err := s.Repos.Section.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to list sections: %v", err)
	}

	byID := make(map[string]*repository.Source, len(sources))
	for i := range sources {
		byID[sources[i].ID] = &sources[i]
	}

	citedOrder := make([]string, 0, len(sources))
	seen := map[string]bool{}
	orphans := make([]string, 0)
	for i := range sections {
		for _, id := range collectCitationSourceIDs(sections[i].Content) {
			if seen[id] {
				continue
			}
			seen[id] = true
			if _, ok := byID[id]; ok {
				citedOrder = append(citedOrder, id)
			} else {
				orphans = append(orphans, id)
			}
		}
	}

	ordered := make([]string, 0, len(sources))
	appendSource := func(src *repository.Source) {
		if raw, err := json.Marshal(src.CSL); err == nil {
			ordered = append(ordered, string(raw))
		}
	}
	for _, id := range citedOrder {
		appendSource(byID[id])
	}
	// Uncited sources land at the end (they only appear at all when the
	// document setting or a per-source override asks for them, FR-BIB-07);
	// `alphabetical` mode re-sorts the whole list downstream anyway.
	for i := range sources {
		src := &sources[i]
		if seen[src.ID] {
			continue
		}
		if doc.Settings.IncludeUncited || src.IncludeUncitedOverride {
			appendSource(src)
		}
	}
	return ordered, orphans, nil
}

// collectCitationSourceIDs walks ProseMirror JSON collecting citation node
// targets in document order. Citations are inline nodes (FR-BIB-05) whose
// `sourceId` attr references a source record; the rendered `[N]` is computed,
// never stored.
func collectCitationSourceIDs(node map[string]any) []string {
	var out []string
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if n == nil {
			return
		}
		if n["type"] == "citation" {
			if attrs, ok := n["attrs"].(map[string]any); ok {
				if id, ok := attrs["sourceId"].(string); ok && id != "" {
					out = append(out, id)
				}
			}
		}
		content, ok := n["content"].([]any)
		if !ok {
			return
		}
		for _, child := range content {
			if childMap, ok := child.(map[string]any); ok {
				walk(childMap)
			}
		}
	}
	walk(node)
	return out
}

func decodeCSL(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	var csl map[string]any
	if err := json.Unmarshal([]byte(raw), &csl); err != nil {
		return nil, grpcerr.InvalidArgument("csl_json is not valid JSON",
			grpcerr.FieldViolation{Field: "csl_json", Description: "must be a valid CSL-JSON object"})
	}
	return csl, nil
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func sourceToProto(src *repository.Source) *pb.Source {
	cslJSON := "{}"
	if len(src.CSL) > 0 {
		if raw, err := json.Marshal(src.CSL); err == nil {
			cslJSON = string(raw)
		}
	}
	return &pb.Source{
		Id:                     src.ID,
		DocumentId:             src.DocumentID,
		CslJson:                cslJSON,
		Language:               src.Language,
		RawInput:               src.RawInput,
		FillStatus:             src.FillStatus,
		AccessDate:             src.AccessDate,
		IncludeUncitedOverride: src.IncludeUncitedOverride,
		CreatedAt:              timestamppb.New(src.CreatedAt),
	}
}
