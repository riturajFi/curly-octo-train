# VC WhatsApp Agent

Researches recently funded startups that fit your AI/full-stack profile, then sends a short WhatsApp message.

The QR is shown on a webpage, not only in logs.

## Local

Create `.env`:

```env
OPENAI_API_KEY=sk-your-key
TARGET_NUMBER=918917200633
MANUAL_RUN_TOKEN=some-long-random-string
```

Run:

```bash
npm install
npm start
```

Open QR page:

```text
http://localhost:3000/qr?token=some-long-random-string
```

Scan from WhatsApp:

```text
WhatsApp -> Linked devices -> Link a device
```

Run research manually:

```text
http://localhost:3000/run?token=some-long-random-string
```

Check status:

```text
http://localhost:3000
```

## Railway

Set env vars:

```text
OPENAI_API_KEY=sk-your-key
TARGET_NUMBER=918917200633
MANUAL_RUN_TOKEN=some-long-random-string
PERSIST_WHATSAPP_SESSION=false
```

By default, Railway should use:

```text
PERSIST_WHATSAPP_SESSION=false
```

This avoids Chromium profile lock errors. You will need to scan the QR again
after a fresh Railway container start.

Open:

```text
https://your-app.up.railway.app/qr?token=some-long-random-string
```

After scanning, trigger:

```text
https://your-app.up.railway.app/run?token=some-long-random-string
```

If Railway shows a Chromium profile lock, temporarily set this for one redeploy:

```text
CLEAR_CHROME_LOCKS=true
```

Remove it after the app starts normally.

Persistent Railway sessions are possible, but they can hit Chromium profile
locks during redeploys. Only enable this if you have a volume attached and are
okay handling lock recovery:

```text
PERSIST_WHATSAPP_SESSION=true
```
