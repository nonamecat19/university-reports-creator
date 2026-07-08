// Package clients dials the other backends service-document is allowed to
// call directly: service-render (the sanctioned FR-ARC-07 edge, for template
// parsing and export) and service-files (to resolve template/image bytes for
// those calls). No other service-to-service edges exist.
package clients

import (
	filepb "github.com/nnc/university-reports-creator/gen/go/file"
	renderpb "github.com/nnc/university-reports-creator/gen/go/render"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcclient"
)

type Clients struct {
	Render renderpb.RenderServiceClient
	Files  filepb.FileServiceClient
}

func Dial(renderAddr, filesAddr string) (*Clients, error) {
	renderConn, err := grpcclient.Dial(renderAddr)
	if err != nil {
		return nil, err
	}
	filesConn, err := grpcclient.Dial(filesAddr)
	if err != nil {
		return nil, err
	}
	return &Clients{
		Render: renderpb.NewRenderServiceClient(renderConn),
		Files:  filepb.NewFileServiceClient(filesConn),
	}, nil
}
