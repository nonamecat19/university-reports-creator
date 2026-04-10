package model

import "time"

type User struct {
	ID             string
	Email          string
	Name           string
	HashedPassword string
	CreatedAt      time.Time
}
