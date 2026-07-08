package service

import (
	"github.com/nnc/university-reports-creator/service-document/internal/clients"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

type Base struct {
	Repos    *repository.Repos
	Clients  *clients.Clients
	Services *Services
}

func (b *Base) Init(repos *repository.Repos, cl *clients.Clients, services *Services) {
	b.Repos = repos
	b.Clients = cl
	b.Services = services
}
