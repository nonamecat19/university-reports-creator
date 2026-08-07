package service

import (
	"sync"
	"time"

	pb "github.com/nnc/university-reports-creator/gen/go/file"
)

// SessionTTL is FR-API-13's "sessions expire after 15 min": a session that
// stops receiving chunks is discarded, so an abandoned upload leaks nothing.
const SessionTTL = 15 * time.Minute

// uploadSession is one in-flight chunk upload.
//
// Chunks are buffered in memory rather than written to MinIO as multipart
// parts. At NFR-05's ceilings (20 MB templates, 10 MB images) that is a small
// bounded cost, and it buys two things the multipart route does not: content
// sniffing and size validation happen before *anything* is written, and an
// abandoned session leaves no orphaned parts to garbage-collect — expiry is
// simply dropping the buffer.
//
// The trade-off is that sessions are per-process: a client must send every
// chunk of one upload to the same replica. service-files is otherwise
// stateless, so this is the one thing that needs session affinity (or a single
// replica) until uploads move to a shared store.
type uploadSession struct {
	id           string
	purpose      pb.Purpose
	rules        purposeRules
	filename     string
	declaredSize int64
	buffer       []byte
	nextSeq      int32
	lastTouched  time.Time
}

type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]*uploadSession
	ttl      time.Duration
	now      func() time.Time
}

func newSessionStore(ttl time.Duration) *sessionStore {
	return &sessionStore{
		sessions: make(map[string]*uploadSession),
		ttl:      ttl,
		now:      time.Now,
	}
}

func (s *sessionStore) put(session *uploadSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session.lastTouched = s.now()
	s.sessions[session.id] = session
}

// get returns the session and reports whether it is still alive. An expired
// session is dropped on access, so a caller never sees stale data even if the
// sweeper has not run yet.
func (s *sessionStore) get(id string) (*uploadSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[id]
	if !ok {
		return nil, false
	}
	if s.now().Sub(session.lastTouched) > s.ttl {
		delete(s.sessions, id)
		return nil, false
	}
	return session, true
}

// touch marks a session as active while holding the lock, so concurrent chunk
// writes to one session cannot interleave.
func (s *sessionStore) touch(session *uploadSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session.lastTouched = s.now()
}

func (s *sessionStore) remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

// sweep drops every expired session and reports how many went. Called on a
// timer by the service, and directly by tests.
func (s *sessionStore) sweep() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	removed := 0
	for id, session := range s.sessions {
		if now.Sub(session.lastTouched) > s.ttl {
			delete(s.sessions, id)
			removed++
		}
	}
	return removed
}

func (s *sessionStore) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}
