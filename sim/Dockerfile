# sim/Dockerfile — the exit route. Not used on Vercel; see web/docs/DEPLOY.md
# section 7 for when and how. Build from the repository root:
#   docker build -f sim/Dockerfile -t epichat-sim .
#   docker run -p 8000:8000 -e SIM_SHARED_SECRET=... -e ANTHROPIC_API_KEY=... epichat-sim
FROM python:3.12-slim
WORKDIR /app
COPY sim/requirements.txt sim/requirements.txt
RUN pip install --no-cache-dir -r sim/requirements.txt
COPY epichat epichat
COPY templates templates
COPY sim sim
WORKDIR /app/sim
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
