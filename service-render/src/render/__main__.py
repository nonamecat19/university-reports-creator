"""service-render entry point (FR-ARC-03, port :50054)."""

from __future__ import annotations

import asyncio
import signal
import sys
from pathlib import Path

import grpc

from render.config import RenderConfig
from render.server import RenderServicer
from shared.config import get_config
from shared.logging import setup_logging


def generate_proto_stubs() -> None:
    """Generate Python proto stubs from .proto files when they are missing or
    older than the .proto they came from.

    The staleness check matters: without it an edited render.proto silently
    keeps the previous stubs, and the new field just never arrives.
    """
    proto_dir = Path(__file__).parent.parent.parent.parent / "proto" / "render"
    output_dir = Path(__file__).parent / "proto"

    generated = list(output_dir.glob("*_pb2.py")) if output_dir.exists() else []
    source = proto_dir / "render.proto"
    if generated and (not source.exists() or all(g.stat().st_mtime >= source.stat().st_mtime for g in generated)):
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        import grpc_tools
        from grpc_tools import protoc

        proto_file = proto_dir / "render.proto"
        if not proto_file.exists():
            raise FileNotFoundError(f"Proto file not found: {proto_file}")

        well_known_types_dir = Path(grpc_tools.__file__).parent / "_proto"

        result = protoc.main(
            [
                "grpc_tools.protoc",
                f"-I{proto_dir}",
                f"-I{well_known_types_dir}",
                f"--python_out={output_dir}",
                f"--grpc_python_out={output_dir}",
                proto_file.name,
            ]
        )

        if result != 0:
            raise RuntimeError(f"protoc failed with exit code {result}")

        (output_dir / "__init__.py").touch()

        for py_file in output_dir.glob("*.py"):
            if py_file.name == "__init__.py":
                continue
            content = py_file.read_text()
            content = content.replace("import render_pb2", "from render.proto import render_pb2")
            py_file.write_text(content)

        print(f"Generated proto stubs in {output_dir}")
    except ImportError:
        print("grpcio-tools not available, skipping proto generation", file=sys.stderr)
        raise


async def serve() -> None:
    cfg = get_config(RenderConfig)
    setup_logging(level=cfg.log_level, json_format=cfg.json_logging)

    generate_proto_stubs()

    proto_dir = Path(__file__).parent / "proto"
    if str(proto_dir) not in sys.path:
        sys.path.insert(0, str(proto_dir))

    from render.proto import render_pb2_grpc

    servicer = RenderServicer(config=cfg)

    server = grpc.aio.server()
    render_pb2_grpc.add_RenderServiceServicer_to_server(servicer, server)
    server.add_insecure_port(f"[::]:{cfg.port}")

    await server.start()
    print(f"service-render started on port {cfg.port}")

    stop_event = asyncio.Event()

    def shutdown(signum: int, frame: object) -> None:
        print(f"\nReceived signal {signum}, shutting down...")
        stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    await stop_event.wait()
    await server.stop(grace=5)


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
