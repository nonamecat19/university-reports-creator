// Package grpcerr builds/parses google.rpc.Status error details (FR-API-03,
// FR-ARC-15) so error conventions stay identical across services.
package grpcerr

import (
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// FieldViolation describes one invalid request field (INVALID_ARGUMENT).
type FieldViolation struct {
	Field       string
	Description string
}

func InvalidArgument(msg string, violations ...FieldViolation) error {
	st := status.New(codes.InvalidArgument, msg)
	if len(violations) == 0 {
		return st.Err()
	}
	br := &errdetails.BadRequest{}
	for _, v := range violations {
		br.FieldViolations = append(br.FieldViolations, &errdetails.BadRequest_FieldViolation{
			Field:       v.Field,
			Description: v.Description,
		})
	}
	if withDetails, err := st.WithDetails(br); err == nil {
		return withDetails.Err()
	}
	return st.Err()
}

// StaleRevision builds a FAILED_PRECONDITION carrying the current revision
// (FR-DAT-02): the writer retries with an up-to-date value.
func StaleRevision(msg string, currentRevision int32) error {
	st := status.New(codes.FailedPrecondition, msg)
	info := &errdetails.PreconditionFailure{
		Violations: []*errdetails.PreconditionFailure_Violation{
			{
				Type:        "STALE_REVISION",
				Subject:     "revision",
				Description: msg,
			},
		},
	}
	withDetails, err := st.WithDetails(info, &errdetails.ErrorInfo{
		Reason: "STALE_REVISION",
		Metadata: map[string]string{
			"current_revision": itoa(currentRevision),
		},
	})
	if err != nil {
		return st.Err()
	}
	return withDetails.Err()
}

func itoa(v int32) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [12]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// CurrentRevision extracts the current_revision metadata set by StaleRevision,
// for clients that need to retry automatically.
func CurrentRevision(err error) (int32, bool) {
	st, ok := status.FromError(err)
	if !ok {
		return 0, false
	}
	for _, d := range st.Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok && info.Reason == "STALE_REVISION" {
			raw, ok := info.Metadata["current_revision"]
			if !ok {
				return 0, false
			}
			var v int32
			for _, c := range raw {
				if c < '0' || c > '9' {
					return 0, false
				}
				v = v*10 + int32(c-'0')
			}
			return v, true
		}
	}
	return 0, false
}

// ExportViolation is one blocking finding from the pre-export validation gate
// (FR-EXP-06): a required field left empty, an orphaned citation, a table lint
// error. Subject identifies what to fix (field name, source id, section id).
type ExportViolation struct {
	Type        string
	Subject     string
	Description string
}

// ExportValidationFailed builds a FAILED_PRECONDITION carrying the structured
// violation list the export checklist dialog renders (FR-EXP-06). The server
// re-validates what the client already checked, so the details must be
// machine-readable, not just a message.
func ExportValidationFailed(msg string, violations []ExportViolation) error {
	st := status.New(codes.FailedPrecondition, msg)
	pf := &errdetails.PreconditionFailure{}
	for _, v := range violations {
		pf.Violations = append(pf.Violations, &errdetails.PreconditionFailure_Violation{
			Type:        v.Type,
			Subject:     v.Subject,
			Description: v.Description,
		})
	}
	withDetails, err := st.WithDetails(pf, &errdetails.ErrorInfo{Reason: "EXPORT_VALIDATION_FAILED"})
	if err != nil {
		return st.Err()
	}
	return withDetails.Err()
}

// ExportViolations extracts the violations built by ExportValidationFailed.
func ExportViolations(err error) ([]ExportViolation, bool) {
	st, ok := status.FromError(err)
	if !ok {
		return nil, false
	}
	for _, d := range st.Details() {
		pf, ok := d.(*errdetails.PreconditionFailure)
		if !ok {
			continue
		}
		out := make([]ExportViolation, 0, len(pf.Violations))
		for _, v := range pf.Violations {
			out = append(out, ExportViolation{Type: v.Type, Subject: v.Subject, Description: v.Description})
		}
		return out, true
	}
	return nil, false
}
