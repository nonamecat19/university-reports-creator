FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pkg/shared-py ./pkg/shared-py
COPY proto ./proto

RUN pip install --no-cache-dir ./pkg/shared-py

COPY service-render ./service-render
WORKDIR /app/service-render

RUN pip install --no-cache-dir -e .
RUN python -c "from render.__main__ import generate_proto_stubs; generate_proto_stubs()"

FROM python:3.12-slim

# LibreOffice headless for .doc conversion (FR-TPL-01) and PDF export
# (FR-EXP-01 step 8). Baked into the same image per FR-ARC-03 — not a
# separate container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/service-render /app/service-render
COPY --from=builder /app/proto /app/proto

EXPOSE 50054

CMD ["python", "-m", "render"]
