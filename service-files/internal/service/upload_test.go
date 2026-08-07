package service

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/nnc/university-reports-creator/gen/go/file"
)

// newTestService builds a service without a MinIO client. Every RPC exercised
// here (Begin/Chunk, and the validation half of Complete) rejects or accepts
// before anything is stored, which is the point: nothing invalid ever reaches
// object storage.
func newTestService() *FileService {
	return &FileService{sessions: newSessionStore(SessionTTL)}
}

func pngBytes(padding int) []byte {
	return append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, bytes.Repeat([]byte{0}, padding)...)
}

func codeOf(t *testing.T, err error) codes.Code {
	t.Helper()
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected a gRPC status error, got %v", err)
	}
	return st.Code()
}

func TestSniffContentType(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"png", pngBytes(16), contentTypePNG},
		{"jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}, contentTypeJPEG},
		{"pdf", []byte("%PDF-1.7\n..."), contentTypePDF},
		{"docx (zip)", []byte("PK\x03\x04rest of the zip"), contentTypeDocx},
		{"legacy doc (OLE2)", []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1}, contentTypeDoc},
		{"svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`), contentTypeSVG},
		{"svg without the xml declaration", []byte("<svg viewBox='0 0 1 1'></svg>"), contentTypeSVG},
		{"empty", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sniffContentType(tc.data); got != tc.want {
				t.Fatalf("sniffContentType = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSniffIgnoresTheDeclaredExtension(t *testing.T) {
	// NFR-05: content-sniffed, not extension-trusted. An executable renamed
	// to .png must not pass as an image.
	if got := sniffContentType([]byte("MZ\x90\x00\x03executable")); got == contentTypePNG {
		t.Fatal("an executable was sniffed as a PNG")
	}
}

func TestValidateContentPerPurpose(t *testing.T) {
	_, imageRules := resolvePurpose(pb.Purpose_PURPOSE_IMAGES)
	_, templateRules := resolvePurpose(pb.Purpose_PURPOSE_TEMPLATES)

	if _, err := validateContent(pngBytes(4), pb.Purpose_PURPOSE_IMAGES, imageRules); err != nil {
		t.Fatalf("a PNG must be accepted for images: %v", err)
	}
	// A docx is a perfectly valid file — just not an image.
	if _, err := validateContent([]byte("PK\x03\x04zip"), pb.Purpose_PURPOSE_IMAGES, imageRules); err == nil {
		t.Fatal("a docx must not be accepted as an image")
	}
	if _, err := validateContent(pngBytes(4), pb.Purpose_PURPOSE_TEMPLATES, templateRules); err == nil {
		t.Fatal("a PNG must not be accepted as a template")
	}
}

func TestUnspecifiedPurposeFallsBackToTheStrictestRules(t *testing.T) {
	purpose, rules := resolvePurpose(pb.Purpose_PURPOSE_UNSPECIFIED)
	if purpose != pb.Purpose_PURPOSE_IMAGES {
		t.Fatalf("unspecified purpose resolved to %v", purpose)
	}
	if rules.maxBytes != 10*1024*1024 {
		t.Fatalf("unexpected fallback limit %d", rules.maxBytes)
	}
}

func TestBeginUploadRejectsAnOversizedDeclaration(t *testing.T) {
	svc := newTestService()

	_, err := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{
		Purpose: pb.Purpose_PURPOSE_IMAGES,
		Size:    11 * 1024 * 1024, // NFR-05 caps images at 10 MB
	})
	if got := codeOf(t, err); got != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", got)
	}
	if svc.sessions.len() != 0 {
		t.Fatal("a rejected BeginUpload must not leave a session behind")
	}
}

func TestChunkSequence(t *testing.T) {
	svc := newTestService()
	begin, err := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{
		Purpose: pb.Purpose_PURPOSE_IMAGES,
		Size:    6,
	})
	if err != nil {
		t.Fatalf("BeginUpload: %v", err)
	}
	if begin.GetMaxChunkBytes() != MaxChunkBytes {
		t.Fatalf("unexpected max chunk size %d", begin.GetMaxChunkBytes())
	}

	resp, err := svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 0, Data: []byte("abc"),
	})
	if err != nil {
		t.Fatalf("first chunk: %v", err)
	}
	if resp.GetNextSeq() != 1 || resp.GetReceivedBytes() != 3 {
		t.Fatalf("unexpected chunk response %+v", resp)
	}

	// Out-of-order chunks are refused rather than silently reordered.
	_, err = svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 5, Data: []byte("xyz"),
	})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for an out-of-order chunk, got %v", got)
	}

	// A retried chunk is idempotent — it must not append its bytes twice.
	resp, err = svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 0, Data: []byte("abc"),
	})
	if err != nil {
		t.Fatalf("retried chunk: %v", err)
	}
	if resp.GetReceivedBytes() != 3 {
		t.Fatalf("a retried chunk duplicated data: %d bytes", resp.GetReceivedBytes())
	}
}

func TestChunkLargerThanTheLimitIsRefused(t *testing.T) {
	svc := newTestService()
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{Purpose: pb.Purpose_PURPOSE_IMAGES})

	_, err := svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 0, Data: make([]byte, MaxChunkBytes+1),
	})
	if got := codeOf(t, err); got != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", got)
	}
}

func TestChunksExceedingThePurposeLimitDropTheSession(t *testing.T) {
	svc := newTestService()
	// Declared size stays inside the limit; the bytes that actually arrive do not.
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{Purpose: pb.Purpose_PURPOSE_IMAGES, Size: 1})

	var err error
	for seq := int32(0); seq < 6 && err == nil; seq++ {
		_, err = svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
			UploadId: begin.GetUploadId(), Seq: seq, Data: make([]byte, MaxChunkBytes),
		})
	}
	if got := codeOf(t, err); got != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted once past 10 MB, got %v", got)
	}
	if svc.sessions.len() != 0 {
		t.Fatal("an over-limit session must be dropped, not left buffering")
	}
}

func TestCompleteRejectsASizeMismatch(t *testing.T) {
	svc := newTestService()
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{
		Purpose: pb.Purpose_PURPOSE_IMAGES, Size: 100,
	})
	if _, err := svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 0, Data: pngBytes(4),
	}); err != nil {
		t.Fatalf("chunk: %v", err)
	}

	_, err := svc.CompleteUpload(context.Background(), &pb.CompleteUploadRequest{UploadId: begin.GetUploadId()})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", got)
	}
	if !strings.Contains(status.Convert(err).Message(), "declared") {
		t.Fatalf("error should name the mismatch: %v", err)
	}
	if svc.sessions.len() != 0 {
		t.Fatal("a completed (even failed) session must be released")
	}
}

func TestCompleteRejectsAWrongContentType(t *testing.T) {
	svc := newTestService()
	docx := []byte("PK\x03\x04zip pretending to be an image")
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{
		Purpose: pb.Purpose_PURPOSE_IMAGES, Size: int64(len(docx)), ContentType: "image/png",
	})
	if _, err := svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{
		UploadId: begin.GetUploadId(), Seq: 0, Data: docx,
	}); err != nil {
		t.Fatalf("chunk: %v", err)
	}

	// The declared content type said image/png; the bytes say otherwise.
	_, err := svc.CompleteUpload(context.Background(), &pb.CompleteUploadRequest{UploadId: begin.GetUploadId()})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", got)
	}
}

func TestCompleteRejectsAnEmptyUpload(t *testing.T) {
	svc := newTestService()
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{Purpose: pb.Purpose_PURPOSE_IMAGES})

	_, err := svc.CompleteUpload(context.Background(), &pb.CompleteUploadRequest{UploadId: begin.GetUploadId()})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", got)
	}
}

func TestUnknownOrExpiredSession(t *testing.T) {
	svc := newTestService()

	_, err := svc.UploadChunk(context.Background(), &pb.UploadChunkRequest{UploadId: "nope", Seq: 0})
	if got := codeOf(t, err); got != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", got)
	}
	_, err = svc.CompleteUpload(context.Background(), &pb.CompleteUploadRequest{UploadId: "nope"})
	if got := codeOf(t, err); got != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", got)
	}
}

func TestAbortReleasesTheSession(t *testing.T) {
	svc := newTestService()
	begin, _ := svc.BeginUpload(context.Background(), &pb.BeginUploadRequest{Purpose: pb.Purpose_PURPOSE_IMAGES})

	if _, err := svc.AbortUpload(context.Background(), &pb.AbortUploadRequest{UploadId: begin.GetUploadId()}); err != nil {
		t.Fatalf("AbortUpload: %v", err)
	}
	if svc.sessions.len() != 0 {
		t.Fatal("AbortUpload must free the session")
	}
}

func TestSessionsExpire(t *testing.T) {
	store := newSessionStore(SessionTTL)
	now := time.Now()
	store.now = func() time.Time { return now }
	store.put(&uploadSession{id: "s1"})

	// Still inside the window.
	now = now.Add(SessionTTL - time.Second)
	if _, ok := store.get("s1"); !ok {
		t.Fatal("session expired early")
	}

	// FR-API-13: 15 minutes without a chunk and the session is gone.
	now = now.Add(2 * time.Second)
	if _, ok := store.get("s1"); ok {
		t.Fatal("expired session was still served")
	}
}

func TestSweepDropsAbandonedSessions(t *testing.T) {
	store := newSessionStore(SessionTTL)
	now := time.Now()
	store.now = func() time.Time { return now }
	store.put(&uploadSession{id: "old"})

	now = now.Add(SessionTTL + time.Minute)
	store.put(&uploadSession{id: "fresh"})

	if removed := store.sweep(); removed != 1 {
		t.Fatalf("expected 1 abandoned session to be swept, got %d", removed)
	}
	if _, ok := store.get("fresh"); !ok {
		t.Fatal("the sweeper took a live session")
	}
}

func TestUploadValidatesLikeASession(t *testing.T) {
	svc := newTestService()

	_, err := svc.Upload(context.Background(), &pb.UploadRequest{
		Purpose: pb.Purpose_PURPOSE_IMAGES,
		Data:    []byte("PK\x03\x04not an image"),
	})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", got)
	}

	_, err = svc.Upload(context.Background(), &pb.UploadRequest{Purpose: pb.Purpose_PURPOSE_IMAGES})
	if got := codeOf(t, err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for an empty upload, got %v", got)
	}
}

func TestPurposeDecidesTheKeyPrefix(t *testing.T) {
	for purpose, want := range map[pb.Purpose]string{
		pb.Purpose_PURPOSE_TEMPLATES: "templates/",
		pb.Purpose_PURPOSE_EXPORTS:   "exports/",
		pb.Purpose_PURPOSE_IMAGES:    "images/",
	} {
		if _, rules := resolvePurpose(purpose); rules.prefix != want {
			t.Fatalf("%v prefix = %q, want %q", purpose, rules.prefix, want)
		}
	}
}
