# VC WhatsApp Agent

Daily VC funding brief sent to WhatsApp using WhatsApp Web QR login.

## Configure

Edit `config.js`:

```js
targetNumber: "91YOURNUMBER"
```

Or set it as an environment variable:

```bash
export TARGET_NUMBER="91YOURNUMBER"
```

For local use, create `.env`:

```env
OPENAI_API_KEY=sk-...
TARGET_NUMBER=91YOURNUMBER
```

Optional manual-run protection:

```env
MANUAL_RUN_TOKEN=some-long-random-string
```

## Run Locally

```bash
npm install
npm start
```

Scan the QR from WhatsApp:

```text
Linked devices -> Link a device
```

The local session is stored in `./whatsapp-session`.

Check status:

```bash
curl http://localhost:3000
```

Trigger a manual run:

```bash
curl http://localhost:3000/run
```

If `MANUAL_RUN_TOKEN` is set:

```bash
curl "http://localhost:3000/run?token=some-long-random-string"
```

If no QR appears, the app may be trying to reuse an old WhatsApp session. Wait
until the status says `ready`. If it does not become ready, force logout and
restart:

```bash
curl http://localhost:3000/logout
```

Then stop `npm start` with `Ctrl+C` and run it again:

```bash
npm start
```

## Deploy To Railway

1. Push this repo to GitHub.
2. Railway -> New Project -> Deploy from GitHub repo.
3. Add `OPENAI_API_KEY`.
4. Add `TARGET_NUMBER`, for example `919876543210`.
5. Optional: add `MANUAL_RUN_TOKEN`.
6. Add a volume mounted at `/data`.
7. Redeploy.
8. Open Railway logs and scan the QR.

Railway exposes the volume path through `RAILWAY_VOLUME_MOUNT_PATH`, so the app stores the WhatsApp session at `/data/whatsapp-session`.

After scanning, open the Railway public URL to check status:

```text
https://your-app.up.railway.app
```

Trigger a manual run:

```text
https://your-app.up.railway.app/run
```

If `MANUAL_RUN_TOKEN` is set:

```text
https://your-app.up.railway.app/run?token=some-long-random-string
```

## Notes

This uses `whatsapp-web.js`, which is unofficial and can break or log out. For production-grade WhatsApp messaging, use Meta's official WhatsApp Business API.
