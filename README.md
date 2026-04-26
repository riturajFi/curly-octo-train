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
```

Attach a Railway volume. The app stores WhatsApp login under:

```text
$RAILWAY_VOLUME_MOUNT_PATH/whatsapp-session
```

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
