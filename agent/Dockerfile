FROM ghcr.io/aaif-goose/goose:sha-86eec2a
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY agent/bridge.py agent/mcp_tools.py /opt/agent/
RUN chmod -R a+r /opt/agent
USER goose
ENTRYPOINT ["python3", "/opt/agent/bridge.py"]
