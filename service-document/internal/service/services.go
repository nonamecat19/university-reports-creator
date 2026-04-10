package service

import "github.com/nnc/university-reports-creator/service-document/internal/repository"

type Service interface {
	Init(repos *repository.Repos, services *Services)
}

type Services struct {
	Document *DocumentService
	Template *TemplateService
}

func New(repos *repository.Repos) *Services {
	svcs := &Services{
		Document: &DocumentService{},
		Template: &TemplateService{},
	}

	init := []Service{
		svcs.Document,
		svcs.Template,
	}

	for _, s := range init {
		s.Init(repos, svcs)
	}

	return svcs
}
