# Hostinger deployment ☁️

Hummingbird runs on the existing Ubuntu VPS at `hummingbird.chirp.blog`.
It has its own Linux user, PostgreSQL database, application service and Nginx
site. Its Node.js 24 installation is isolated from Chirp's runtime.

## Files and configuration

| Location                                 | Purpose                          |
| ---------------------------------------- | -------------------------------- |
| `/srv/hummingbird/releases/<commit>`     | Application releases             |
| `/srv/hummingbird/current`               | Active release                   |
| `/opt/hummingbird/node`                  | Node.js 24 runtime               |
| `/etc/hummingbird/hummingbird.env`       | Private production configuration |
| `/etc/nginx/sites-available/hummingbird` | Nginx configuration              |

The private environment contains `NODE_ENV=production`, `HOST=127.0.0.1`,
`PORT=3100`, `TRUST_PROXY=loopback`, `DATABASE_URL` and the three Cloudinary
variables. The PostgreSQL database and role are both named `hummingbird`.
PostgreSQL and the application port listen locally; Nginx exposes HTTPS.
Production needs neither a shadow database nor a test database.

## Automatic deployment

Push changes to `main`. [GitHub Actions](https://github.com/TobiasAschenbrenner/hummingbird/actions/workflows/checks.yml)
runs the frontend, backend, database and deployment tests and both builds.
The VPS checks every two minutes and deploys the current `main` commit only after
its push workflow passes. Other branches and failed checks do not deploy.

Each release builds separately as the `hummingbird` user, applies migrations,
then switches the running application. Version, frontend and database-backed API
checks must pass; otherwise the previous application release is restored.
A code rollback does not undo database migrations, so keep migrations compatible
with the previous release. Deployment never resets or seeds the database.

No VPS key, Cloudinary secret or production database password is stored in GitHub.
The updater reads this public repository; making it private requires updating
that access first. The deployed commit is visible at `/release.json`.

```bash
systemctl status hummingbird-deploy.timer
journalctl -u hummingbird-deploy.service -n 50 --no-pager
systemctl start hummingbird-deploy.service
```

To pause automatic updates, run `systemctl disable --now hummingbird-deploy.timer`.
Re-enable them with `systemctl enable --now hummingbird-deploy.timer`.

### Installing the updater

After reviewing these files, install them from a checked-out release as root:

```bash
install -d -m 0755 /usr/local/lib/hummingbird
install -d -o hummingbird -g hummingbird -m 0700 /srv/hummingbird/.cache /srv/hummingbird/.npm-cache
chown root:root /srv/hummingbird /srv/hummingbird/releases
install -m 0644 deploy/deploy.mjs /usr/local/lib/hummingbird/deploy.mjs
install -m 0644 deploy/hummingbird-deploy.service deploy/hummingbird-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hummingbird-deploy.timer
```

The deployment controller is owned by root and is not automatically replaced
with repository code. Changes to it require repeating the reviewed installation.
Run its focused tests with `node --test deploy/*.test.mjs`.

## Loading example data

Run this explicitly from the VPS console after deploying the seed command:

```bash
runuser -u hummingbird -- /bin/sh -c '
  set -a
  . /etc/hummingbird/hummingbird.env
  set +a
  export PATH=/opt/hummingbird/node/bin:$PATH
  cd /srv/hummingbird/current
  npm run db:seed:demo -- --confirm-production-database=hummingbird
'
```

The confirmation is required only for this dedicated production database.
It adds the same synthetic dataset as local seeding, preserves existing content
and creates no duplicates on repeat runs. Demo accounts cannot sign in; create
your own account through the app. The seed does not upload images or alter
Cloudinary assets.

## Services

Install the included `.service` and `.timer` files under `/etc/systemd/system/`.
The application runs without administrator privileges and starts automatically
after reboot. The cleanup timer removes only detached Hummingbird image assets;
its credentials come from the same private environment as the application.

```bash
systemctl status hummingbird
journalctl -u hummingbird -n 50 --no-pager
systemctl list-timers hummingbird-images-cleanup.timer
```

Nginx must pass the original client address exactly as configured in
[hummingbird.nginx.conf](hummingbird.nginx.conf). Keep the app on loopback and
avoid opening PostgreSQL or port 3100 in the firewall. Access the database from
DataGrip through an SSH tunnel when needed.

## HTTPS

The domain's A record points at the VPS. Let's Encrypt certificates use the
webroot `/var/www/hummingbird-acme`; the existing Certbot timer renews them.
The included `hummingbird-cert-renewal-hook` is installed under
`/etc/letsencrypt/renewal-hooks/deploy/` and reloads Nginx after Hummingbird's
certificate renews.

Install only the HTTP block before requesting the first certificate. Enable the
HTTPS block after its certificate files exist, and check `nginx -t` before every
Nginx reload. Existing Chirp sites keep their own configuration.
