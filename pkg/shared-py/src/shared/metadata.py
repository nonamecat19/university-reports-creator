"""User ID extraction from gRPC metadata (FR-ARC-02)."""

from __future__ import annotations

import grpc

USER_ID_KEY = "user-id"


def get_user_id(context: grpc.ServicerContext) -> str:
    """Extract user ID from gRPC metadata injected by the gateway proxy.

    The gateway verifies the JWT and forwards the subject as 'user-id'.
    Raises ValueError if the header is missing.
    """
    metadata = dict(context.invocation_metadata())
    user_id = metadata.get(USER_ID_KEY)
    if not user_id:
        context.abort(grpc.StatusCode.UNAUTHENTICATED, "missing user-id in metadata")
        raise RuntimeError("missing user-id")
    return user_id


def get_request_id(context: grpc.ServicerContext) -> str:
    """Extract request ID from gRPC metadata (FR-AUTH-13)."""
    metadata = dict(context.invocation_metadata())
    return metadata.get("request-id", "unknown")
