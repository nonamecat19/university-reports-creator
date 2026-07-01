FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared library
COPY pkg/shared-py ./pkg/shared-py
COPY proto ./proto

# Install shared library
RUN pip install --no-cache-dir ./pkg/shared-py

# Copy service-ai
COPY service-ai ./service-ai
WORKDIR /app/service-ai

# Install dependencies
RUN pip install --no-cache-dir -e .

# Generate proto stubs
RUN python -c "from ai.__main__ import generate_proto_stubs; generate_proto_stubs()"

FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/service-ai /app/service-ai
COPY --from=builder /app/proto /app/proto

EXPOSE 50055

CMD ["python", "-m", "ai"]
