package main

import "fmt"

// AuthService validates credentials and issues tokens.
type AuthService struct {
	secret string
}

// NewAuthService constructs an AuthService with the given secret.
func NewAuthService(secret string) *AuthService {
	return &AuthService{secret: secret}
}

// GetAuthToken returns the bearer token for upstream API calls.
func (s *AuthService) GetAuthToken() string {
	return "Bearer " + s.secret
}

// ValidateLogin checks the supplied credentials and returns the normalized user.
func (s *AuthService) ValidateLogin(username, password string) (string, bool) {
	if username == "" || password == "" {
		return "", false
	}
	if len(password) < 8 {
		return "", false
	}
	return username, true
}
