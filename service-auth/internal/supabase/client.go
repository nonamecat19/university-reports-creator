package supabase

import (
	"github.com/supabase-community/supabase-go"
)

type Client struct {
	client  *supabase.Client
	anonKey string
}

func NewClient(url, anonKey, serviceKey string) (*Client, error) {
	client, err := supabase.NewClient(url, serviceKey, nil)
	if err != nil {
		return nil, err
	}
	return &Client{
		client:  client,
		anonKey: anonKey,
	}, nil
}

func (c *Client) GetClient() *supabase.Client {
	return c.client
}

func (c *Client) GetAnonKey() string {
	return c.anonKey
}
