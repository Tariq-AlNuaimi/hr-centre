# Rihal Aptitude scoring service (ARCHITECTURE §12.2).
# Deliberately standalone so it runs anywhere (Cloud Run / Fly / Render / a
# container beside the DB) -- NO Vercel lock-in. The Next app reaches it via the
# SCORING_SERVICE_URL env var only.
FROM python:3.11-slim

# No bytecode files, unbuffered logs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

# Install deps first for layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Run as a non-root user (the service holds no secrets/PII, but least-privilege
# still applies).
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Container healthcheck hits the liveness probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
