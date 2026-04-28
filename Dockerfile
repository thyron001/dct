FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY . .

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

ENV PORT=5000

CMD sh -c "gunicorn --bind 0.0.0.0:${PORT} --workers 2 --timeout 120 app:app"
