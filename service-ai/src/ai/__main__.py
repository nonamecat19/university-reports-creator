"""service-ai entry point (FR-ARC-16, port :50055)."""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

import grpc

from ai.config import AIConfig
from ai.providers import create_provider
from ai.server import AIServicer
from shared.config import get_config
from shared.logging import setup_logging


def generate_proto_stubs() -> None:
    """Generate Python proto stubs from .proto files if not already present."""
    proto_dir = Path(__file__).parent.parent.parent / "proto" / "ai"
    output_dir = Path(__file__).parent / "proto"

    if output_dir.exists() and list(output_dir.glob("*.py")):
        return  # Stubs already generated

    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from grpc_tools import protoc

        proto_file = proto_dir / "ai.proto"
        if not proto_file.exists():
            raise FileNotFoundError(f"Proto file not found: {proto_file}")

        result = protoc.main([
            "grpc_tools.protoc",
            f"-I{proto_dir.parent.parent}",
            f"--python_out={output_dir}",
            f"--grpc_python_out={output_dir}",
            str(proto_file),
        ])

        if result != 0:
            raise RuntimeError(f"protoc failed with exit code {result}")

        # Create __init__.py
        (output_dir / "__init__.py").touch()

        # Fix imports in generated files (use relative imports)
        for py_file in output_dir.glob("*.py"):
            if py_file.name == "__init__.py":
                continue
            content = py_file.read_text()
            content = content.replace("import ai_pb2", "from ai.proto import ai_pb2")
            py_file.write_text(content)

        print(f"Generated proto stubs in {output_dir}")
    except ImportError:
        print("grpcio-tools not available, skipping proto generation", file=sys.stderr)
        raise


def main() -> None:
    """Main entry point for service-ai."""
    cfg = get_config(AIConfig)
    setup_logging(level=cfg.log_level, json_format=cfg.json_logging)

    # Generate proto stubs
    generate_proto_stubs()

    # Ensure proto module is importable
    proto_dir = Path(__file__).parent / "proto"
    if str(proto_dir) not in sys.path:
        sys.path.insert(0, str(proto_dir))

    # Import generated stubs
    from ai.proto import ai_pb2, ai_pb2_grpc

    # Create provider
    provider = create_provider(
        provider_type=cfg.ai_provider,
        model=cfg.ai_model,
        base_url=cfg.ollama_base_url,
        api_key=cfg.openai_api_key,
    )

    # Create servicer
    servicer = AIServicer(provider=provider, config=cfg)

    # Create gRPC server
    server = grpc.server(
        __import__("concurrent.futures", fromlist=["ThreadPoolExecutor"]).ThreadPoolExecutor(
            max_workers=cfg.max_workers
        )
    )

    ai_pb2_grpc.add_AIServiceServicer_to_server(servicer, server)
    server.add_insecure_port(f"[::]:{cfg.port}")

    # Graceful shutdown
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def shutdown(signum: int, frame: object) -> None:
        print(f"\nReceived signal {signum}, shutting down...")
        server.stop(grace=5)
        sys.exit(0)

    import signal
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    server.start()
    print(f"service-ai started on port {cfg.port} (provider={cfg.ai_provider}, model={cfg.ai_model})")
    server.wait_for_termination()


if __name__ == "__main__":
    main()
