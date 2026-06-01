# MUUC Trip Leader App

FastAPI app for syncing TeamApp purchases into a local CSV beside the hosted app and looking up emergency contact and purchase details by member name.

## Run

Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

```bash
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>.

## Cookie

Set the TeamApp session cookie in `.env`:

```env
TEAMAPP_COOKIE=...
LOGIN_PIN=change-me
SESSION_SECRET=replace-with-a-long-random-string
```

If the cookie is missing or expired, the app still serves the stored CSV data and shows the refresh issue in the status line.
