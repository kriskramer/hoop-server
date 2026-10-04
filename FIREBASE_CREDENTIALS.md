# Firebase Credentials Setup

The server writes to the Firebase Realtime Database with the **Firebase Admin SDK**
(`firebase.js`). The SDK authenticates with a **service account** through Google
Application Default Credentials (`applicationDefault()`), so no API keys go in the code.

## What's required

| Setting | Required | Purpose |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Full path to the service account JSON key file |
| `FIREBASE_DATABASE_URL` | No | Overrides the default `https://hoopfan-26b24-default-rtdb.firebaseio.com` |

## Setup steps

### 1. Generate a service account key

1. Open the [Firebase console](https://console.firebase.google.com/) and select the project **hoopfan-26b24**.
2. Go to **Project settings** (gear icon), then the **Service accounts** tab.
3. Make sure **Firebase Admin SDK** is selected and click **Generate new private key**.
4. Confirm. A JSON file downloads.

### 2. Store the key outside the repo

Move the file to a location outside the project, for example:

```
C:\Users\<you>\.secrets\hoopfan-sa.json
```

> **Never commit this file.** It grants full admin access to the database. If a key
> ever leaks, delete it in the console (Google Cloud Console → IAM & Admin →
> Service Accounts → Keys) and generate a new one.

### 3. Point `GOOGLE_APPLICATION_CREDENTIALS` at the key

**Windows (persistent, current user), PowerShell:**

```powershell
[Environment]::SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", "C:\Users\<you>\.secrets\hoopfan-sa.json", "User")
```

Then **restart your terminal/editor** so it picks up the new variable.

**Current PowerShell session only:**

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\<you>\.secrets\hoopfan-sa.json"
```

**macOS / Linux / Git Bash:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.secrets/hoopfan-sa.json"
```

To make it persistent, add the line to `~/.bashrc` or `~/.zshrc`.

### 4. (Optional) Override the database URL

Only needed when pointing at a different database:

```powershell
$env:FIREBASE_DATABASE_URL = "https://<other-db>.firebaseio.com"
```

## Verify

```powershell
echo $env:GOOGLE_APPLICATION_CREDENTIALS   # should print the key path
Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS   # should print True
npm start
```

If credentials are missing, the Admin SDK fails on the first database write with an error like
`Could not load the default credentials` or `Failed to determine service account`.

## Alternative: gcloud ADC (local dev only)

If the Google Cloud SDK is installed, you can skip the key file and run:

```bash
gcloud auth application-default login
```

This writes `%APPDATA%\gcloud\application_default_credentials.json`, which
`applicationDefault()` picks up automatically. Your Google account needs access to the
project. The service account key method is still recommended, because user credentials
can lack the Realtime Database scopes.

## Production / hosting

- **On Google Cloud** (Cloud Run, GCE, Cloud Functions): no key file is needed. The attached
  service account is used automatically through the metadata server.
- **Elsewhere**: upload the key file as a secret and set `GOOGLE_APPLICATION_CREDENTIALS`
  to its path in the host's environment.
