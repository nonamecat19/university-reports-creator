package service

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	pb "github.com/nnc/university-reports-creator/gen/go/file"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
)

// Per-purpose limits from NFR-05. A purpose decides three things at once: how
// big a file may be, which content types are accepted, and the key prefix the
// object is stored under — so a template can never be written where images
// live, and an oversized image is refused before it reaches MinIO.
type purposeRules struct {
	prefix   string
	maxBytes int64
	accepted map[string]bool
}

const (
	// gRPC-web has no client streaming, so uploads arrive as a sequence of
	// unary chunks; 2 MB keeps each message comfortably under the default
	// 4 MB gRPC message limit (FR-API-13).
	MaxChunkBytes = 2 * 1024 * 1024

	contentTypeDocx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	contentTypeDoc  = "application/msword"
	contentTypePDF  = "application/pdf"
	contentTypePNG  = "image/png"
	contentTypeJPEG = "image/jpeg"
	contentTypeSVG  = "image/svg+xml"
)

var rulesByPurpose = map[pb.Purpose]purposeRules{
	pb.Purpose_PURPOSE_TEMPLATES: {
		prefix:   "templates/",
		maxBytes: 20 * 1024 * 1024,
		accepted: map[string]bool{contentTypeDocx: true, contentTypeDoc: true},
	},
	pb.Purpose_PURPOSE_IMAGES: {
		prefix:   "images/",
		maxBytes: 10 * 1024 * 1024,
		accepted: map[string]bool{contentTypePNG: true, contentTypeJPEG: true, contentTypeSVG: true},
	},
	pb.Purpose_PURPOSE_EXPORTS: {
		prefix:   "exports/",
		maxBytes: 50 * 1024 * 1024,
		accepted: map[string]bool{contentTypeDocx: true, contentTypePDF: true},
	},
}

// resolvePurpose defaults to images, which carries the strictest useful limit —
// an unspecified purpose is an old client, not a licence to upload anything.
func resolvePurpose(purpose pb.Purpose) (pb.Purpose, purposeRules) {
	if rules, ok := rulesByPurpose[purpose]; ok {
		return purpose, rules
	}
	return pb.Purpose_PURPOSE_IMAGES, rulesByPurpose[pb.Purpose_PURPOSE_IMAGES]
}

func validateDeclaredSize(size int64, rules purposeRules) error {
	if size < 0 {
		return grpcerr.InvalidArgument("size must not be negative",
			grpcerr.FieldViolation{Field: "size", Description: "must be >= 0"})
	}
	if size > rules.maxBytes {
		return grpcerr.ResourceExhausted(fmt.Sprintf("file exceeds the %d MB limit for this purpose", rules.maxBytes/(1024*1024)))
	}
	return nil
}

// sniffContentType determines the real type from the bytes, never from the
// declared header or the extension (NFR-05: "content-sniffed not
// extension-trusted"). Returns "" when the type is not one we accept anywhere.
func sniffContentType(data []byte) string {
	if len(data) == 0 {
		return ""
	}

	switch {
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return contentTypePDF
	case bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return contentTypePNG
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return contentTypeJPEG
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		// Every OOXML file is a zip; the distinction between docx and any
		// other zip is made by the template parser, which opens it.
		return contentTypeDocx
	case bytes.HasPrefix(data, []byte{0xD0, 0xCF, 0x11, 0xE0}):
		// OLE2 compound file — a legacy .doc.
		return contentTypeDoc
	}

	// SVG is XML, so it needs a look at the markup rather than a magic number.
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	lowered := strings.ToLower(string(head))
	if strings.Contains(lowered, "<svg") {
		return contentTypeSVG
	}

	detected := http.DetectContentType(head)
	if i := strings.IndexByte(detected, ';'); i >= 0 {
		detected = detected[:i]
	}
	return detected
}

// validateContent checks the sniffed type against the purpose and returns the
// type to store the object with.
func validateContent(data []byte, purpose pb.Purpose, rules purposeRules) (string, error) {
	sniffed := sniffContentType(data)
	if !rules.accepted[sniffed] {
		accepted := make([]string, 0, len(rules.accepted))
		for t := range rules.accepted {
			accepted = append(accepted, t)
		}
		return "", grpcerr.InvalidArgument(
			fmt.Sprintf("content type %q is not accepted for %s (accepted: %s)",
				sniffed, purposeName(purpose), strings.Join(accepted, ", ")),
			grpcerr.FieldViolation{Field: "data", Description: "file content does not match an accepted type"})
	}
	return sniffed, nil
}

func purposeName(purpose pb.Purpose) string {
	switch purpose {
	case pb.Purpose_PURPOSE_TEMPLATES:
		return "templates"
	case pb.Purpose_PURPOSE_EXPORTS:
		return "exports"
	case pb.Purpose_PURPOSE_IMAGES:
		return "images"
	default:
		return "unspecified"
	}
}
