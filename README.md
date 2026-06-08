# MUUC Trip Organiser App

FastAPI app for syncing TeamApp purchases into a local CSV beside the hosted app and looking up emergency contact and purchase details by member name.

## Run

Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

```bash
uvicorn app.main:app --reload --port 8999
```

Open <http://127.0.0.1:8999>.

## Environment

Create `.env` from `.env.example` for local use:

```env
TEAMAPP_COOKIE=...
LOGIN_PIN=change-me
SESSION_SECRET=replace-with-a-long-random-string
```

If the cookie is missing or expired, the app still serves the stored CSV data and shows the refresh issue in the status line.

## Deploy

The app is a standard FastAPI service. It writes the pulled purchase CSV to `purchases.csv` beside the app, so choose hosting with a persistent filesystem if you want stored data to survive restarts.

### Required Settings

Set these environment variables in your host:

```env
TEAMAPP_COOKIE=...
LOGIN_PIN=...
SESSION_SECRET=...
```

Use a long random value for `SESSION_SECRET`.

### Production Command

Use this start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

If your host does not provide `$PORT`, use a fixed port:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8999
```

### Render-Style Web Service

1. Push this repository to GitHub.
2. Create a new Web Service from the repo.
3. Set the build command:

```bash
pip install -r requirements.txt
```

4. Set the start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

5. Add the required environment variables.
6. Add persistent disk storage if you want `purchases.csv` to survive redeploys and restarts.

### VPS / systemd

Clone the repo and install dependencies:

```bash
git clone https://github.com/sek0002/tripleader.git
cd tripleader
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`, then create a systemd unit such as `/etc/systemd/system/tripleader.service`:

```ini
[Unit]
Description=MUUC Trip Organiser App
After=network.target

[Service]
WorkingDirectory=/path/to/tripleader
EnvironmentFile=/path/to/tripleader/.env
ExecStart=/path/to/tripleader/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8999
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tripleader
```

Put Nginx, Caddy, or another reverse proxy in front of it for HTTPS.
