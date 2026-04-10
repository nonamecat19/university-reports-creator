package service

import "github.com/nnc/university-reports-creator/service-document/internal/repository"

type Base struct {
	Repos    *repository.Repos
	Services *Services
}

func (b *Base) Init(repos *repository.Repos, services *Services) {
	b.Repos = repos
	b.Services = services
}
