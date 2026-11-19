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

## Deploying an update

1. Upload a new committed release into its own directory under `releases/`.
2. Using the isolated Node.js runtime, run root `npm ci` and `npm run build` as
   the `hummingbird` Linux user.
3. Apply `npm run db:deploy` with the private production environment loaded.
4. Point `current` at the completed release and restart only `hummingbird`.
5. Check `/api/health`, article browsing, login and a refreshed article URL.

Keep older releases for rollback. A code rollback does not reverse a database
migration; review migration compatibility before deploying schema changes.
Never copy a local `.env`, development database or `node_modules` into a release.

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
