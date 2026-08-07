package service

import (
	"context"
	"fmt"
	"io"

	filepb "github.com/nnc/university-reports-creator/gen/go/file"
)

// downloadedFile is a whole object pulled back from service-files.
type downloadedFile struct {
	ID          string
	Filename    string
	ContentType string
	Data        []byte
}

// downloadFile reassembles a server-streaming Download (FR-API-13) into bytes.
// The export pipeline needs whole files in memory anyway — it hands them to
// service-render as one request — so the stream is drained here rather than
// threaded further.
func downloadFile(ctx context.Context, client filepb.FileServiceClient, id string) (*downloadedFile, error) {
	stream, err := client.Download(ctx, &filepb.DownloadRequest{Id: id})
	if err != nil {
		return nil, fmt.Errorf("download %q: %w", id, err)
	}

	out := &downloadedFile{ID: id}
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("download %q: %w", id, err)
		}
		// Metadata rides on the first message only.
		if out.Filename == "" && chunk.GetFilename() != "" {
			out.Filename = chunk.GetFilename()
		}
		if out.ContentType == "" && chunk.GetContentType() != "" {
			out.ContentType = chunk.GetContentType()
		}
		out.Data = append(out.Data, chunk.GetData()...)
	}
	return out, nil
}
