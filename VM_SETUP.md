# Hosting on a Google Compute Engine e2-micro VM

This guide runs hoop-server as an always-on `systemd` service on a free-tier e2-micro VM
in the same Google Cloud project as Firebase (`hoopfan-26b24`). The app runs unchanged:
`node index.js`, polling ESPN and writing to the Realtime Database.

See also: [FIREBASE_CREDENTIALS.md](FIREBASE_CREDENTIALS.md) for creating the service account key.

## Free tier requirements

The Compute Engine free tier covers **one** e2-micro VM per billing account, but only if:

| Requirement | Value |
|---|---|
| Region | `us-central1`, `us-east1`, or `us-west1` |
| Machine type | `e2-micro` (2 shared vCPUs, 1 GB RAM) |
| Boot disk | **Standard persistent disk** (`pd-standard`), up to 30 GB. A "balanced" disk is *not* free. |
| Network egress | 1 GB/month free from North America |

Other notes:

- A billing account must be attached to the project even when you stay inside the free tier.
- Use `us-central1`. It's the region of the default Realtime Database instance.
- Free-tier rules change. Check the current terms at
  <https://cloud.google.com/free/docs/free-cloud-features#compute> before relying on them.

> **Watch egress.** During a busy night the server writes a lot to Firebase (roughly 50 KB
> per live game per poll for the header and box score). It isn't certain whether VM → Realtime Database
> traffic counts against the 1 GB egress allowance. Check **Billing → Reports** (filter by
> Compute Engine, SKU "Network") after the first week of games, and set a budget alert
> (step 9) so a surprise costs cents, not dollars.

## 1. Install and configure the gcloud CLI (your PC)

Install from <https://cloud.google.com/sdk/docs/install>, then:

```powershell
gcloud auth login
gcloud config set project hoopfan-26b24
gcloud config set compute/zone us-central1-a
gcloud services enable compute.googleapis.com
```

## 2. Create the VM

```powershell
gcloud compute instances create hoop-server `
  --machine-type=e2-micro `
  --zone=us-central1-a `
  --image-family=debian-12 `
  --image-project=debian-cloud `
  --boot-disk-size=30GB `
  --boot-disk-type=pd-standard `
  --no-service-account --no-scopes
```

- `--no-service-account --no-scopes`: the app authenticates with its own key file
  (step 5), so the VM doesn't need a Google identity of its own.
- No firewall rules are needed. The server makes outbound requests only, and SSH
  through `gcloud compute ssh` is allowed by the default network.

## 3. Install Node.js 22 and git (on the VM)

```powershell
gcloud compute ssh hoop-server
```

Then, on the VM:

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # v22.x
```

**Optional: add swap.** With 1 GB of RAM, `npm install` can occasionally run out of memory:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Create a service user and install the app

Run the app as an unprivileged system user, not as your SSH user:

```bash
sudo useradd --system --create-home --home-dir /opt/hoop-server --shell /usr/sbin/nologin hoop
sudo -u hoop git clone https://github.com/kriskramer/hoop-server.git /opt/hoop-server/app
cd /opt/hoop-server/app
sudo -u hoop npm ci --omit=dev
```

**If the repo is private,** add a read-only deploy key:

1. Generate a key for the `hoop` user:
   ```bash
   sudo -u hoop ssh-keygen -t ed25519 -N "" -f /opt/hoop-server/.ssh/id_ed25519
   ```
2. Add the contents of `/opt/hoop-server/.ssh/id_ed25519.pub` in GitHub under **Repo → Settings → Deploy keys**
   (leave "Allow write access" unchecked).
3. Clone with `git@github.com:kriskramer/hoop-server.git` instead of the HTTPS URL.

## 5. Copy the service account key

From your PC, copy the key file to the VM:

```powershell
gcloud compute scp C:\Users\<you>\.secrets\hoopfan-sa.json hoop-server:/tmp/sa.json
```

On the VM, move it to a private location that only the service user can read:

```bash
sudo mkdir -p /etc/hoop-server
sudo mv /tmp/sa.json /etc/hoop-server/sa.json
sudo chown hoop:hoop /etc/hoop-server/sa.json
sudo chmod 600 /etc/hoop-server/sa.json
```

## 6. Create the systemd service

```bash
sudo tee /etc/systemd/system/hoop-server.service > /dev/null <<'EOF'
[Unit]
Description=hoop-server (ESPN -> Firebase poller)
After=network-online.target
Wants=network-online.target

[Service]
User=hoop
WorkingDirectory=/opt/hoop-server/app
ExecStart=/usr/bin/node index.js
Environment=NODE_ENV=production
Environment=GOOGLE_APPLICATION_CREDENTIALS=/etc/hoop-server/sa.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hoop-server
```

`Restart=always` brings the server back after a crash, and `enable` starts it on boot.

## 7. Check that it's running

```bash
systemctl status hoop-server
journalctl -u hoop-server -f          # follow live logs (Ctrl+C to stop)
journalctl -u hoop-server --since "1 hour ago"
```

You should see `Poll # ...` lines, and on game nights `Game on!` lines. Confirm that data
is arriving in the Firebase console under `gameHeaders`.

## 8. Limit log disk usage

The server logs every poll. Cap the journal so it can't fill the 30 GB disk:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' | sudo tee /etc/systemd/journald.conf.d/size.conf
sudo systemctl restart systemd-journald
```

## 9. Set a budget alert

In the Cloud Console, go to **Billing → Budgets & alerts → Create budget**. Set a small amount
(for example $5) with email alerts at 50%, 90%, and 100%. A budget alert doesn't stop spending;
it only notifies you.

## Deploying updates

Push your changes to GitHub, then on the VM:

```bash
cd /opt/hoop-server/app
sudo -u hoop git pull
sudo -u hoop npm ci --omit=dev
sudo systemctl restart hoop-server
```

On restart, the server re-runs its backfill and rewrites each game's plays once. This is
expected (see `docs/architecture.md`).

## Common commands

| Task | Command |
|---|---|
| SSH into the VM | `gcloud compute ssh hoop-server` |
| Restart the app | `sudo systemctl restart hoop-server` |
| Stop the app | `sudo systemctl stop hoop-server` |
| Follow logs | `journalctl -u hoop-server -f` |
| Stop the VM (off-season) | `gcloud compute instances stop hoop-server` |
| Start the VM | `gcloud compute instances start hoop-server` |

## Rotating the service account key

1. Generate a new key in the Firebase console (see FIREBASE_CREDENTIALS.md).
2. Copy it to the VM (step 5), overwriting `/etc/hoop-server/sa.json`.
3. Restart the app: `sudo systemctl restart hoop-server`.
4. Delete the old key in **Cloud Console → IAM & Admin → Service Accounts → Keys**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Could not load the default credentials` | `GOOGLE_APPLICATION_CREDENTIALS` is wrong in the unit file, or the `hoop` user can't read the key |
| `npm ci` killed / exits with code 137 | Out of memory. Add swap (step 3) |
| Service restarts in a loop | Run `journalctl -u hoop-server -n 50` to see the error |
| Unexpected charges | Disk type isn't `pd-standard`, region isn't one of the free-tier regions, or network egress exceeded 1 GB |
