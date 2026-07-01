"""gRPC server bootstrap helpers (FR-ARC-16)."""

from __future__ import annotations

import logging
import signal
import sys
from concurrent import futures
from typing import Any

import grpc

logger = logging.getLogger(__name__)


class GrpcServer:
    """Thin wrapper around grpc.server with standard interceptors and graceful shutdown."""

    def __init__(
        self,
        port: int,
        max_workers: int = 10,
        interceptors: list[grpc.ServerInterceptor] | None = None,
    ) -> None:
        self.port = port
        self._server = grpc.server(
            futures.ThreadPoolExecutor(max_workers=max_workers),
            interceptors=interceptors or [],
        )
        self._server.add_insecure_port(f"[::]:{port}")

    @property
    def server(self) -> grpc.Server:
        return self._server

    def register_service(self, service: Any, servicer: Any) -> None:
        """Register a gRPC service servicer.

        Usage::

            server.register_service(pb2_grpc.AIServiceServicer, AIServicer())
        """
        service.add_to_server(servicer, self._server)

    def start(self) -> None:
        """Start the server and block until interrupted."""
        self._server.start()
        logger.info("gRPC server started on port %d", self.port)

        # Graceful shutdown on SIGINT/SIGTERM
        def _shutdown(signum: int, frame: Any) -> None:
            logger.info("Received signal %d, shutting down...", signum)
            self._server.stop(grace=5)
            sys.exit(0)

        signal.signal(signal.SIGINT, _shutdown)
        signal.signal(signal.SIGTERM, _shutdown)

        self._server.wait_for_termination()
