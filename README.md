# Waymark ticketing

Multi-tenant ticket workflow app built with FastAPI, SQLite, React/TypeScript, and Tailwind.

## Run with Docker

1. Copy `.env.example` to `.env` in the repository root. Replace `APP_SECRET` with a randomly generated string of at least 32 characters, for example from `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Optionally change `PORT`. For HTTPS deployments, also set `COOKIE_SECURE=1` and terminate TLS at a reverse proxy.
2. Run `make prod` (equivalent to `docker compose -p ticketing-prod -f docker-compose.yml up --build -d`).
3. Run `make prod-key`. Save the printed **one-time** key.
4. Open `http://localhost:8080`, select **First time here? Set up admin**, and create the first admin account with that key and a password of at least 12 characters.

The bootstrap key becomes invalid on use; running `generate-key` again before setup invalidates any earlier key. Once an admin exists, bootstrap generation is disabled. The SQLite database persists in the `ticket_data` Docker volume. Keep `.env` private and back up this volume.

GitHub production deployments run on a self-hosted runner and use `/etc/ticketing/production.env` as the Compose environment file. Create that file on the runner from `.env.example` and secure it with owner-only read/write permissions. The deployment workflow checks out the selected commit cleanly, then runs `make deploy DEPLOY_REF=<commit-sha>`; `make deploy` verifies the external env file exists and deploys that exact revision. To use another location, set `DEPLOY_ENV_FILE` on the runner or pass it to Make. Local `make prod` continues to use the repository-root `.env` by default.

For local development **without Docker**, copy `.env.example` to `.env`, install Python 3.12+ and Node 22+, then run `make dev` once to install the Python and npm dependencies and apply migrations. Open two terminals: run `make dev-api` in one and `make dev-ui` in the other. `make dev-api` applies pending migrations automatically before starting FastAPI. You can also run `make migrate` to apply migrations explicitly. On a fresh database, run `make dev-key` and use its one-time key to bootstrap the admin. Open `http://localhost:5173`; Vite proxies API calls to the local FastAPI server. Local development uses `backend/ticketing.db`, separate from Docker's named volume. Stop the servers with Ctrl+C in their terminals. Production remains Docker-based via `make prod`; `make prod-down` stops the production stack. Run `make test` for backend tests and the UI production build.

## Database configuration and migrations

SQLAlchemy ORM and Alembic support SQLite (default), PostgreSQL, and MySQL. Set `DATABASE_URL` to a SQLAlchemy URL, for example:

| Database | `DATABASE_URL` example |
| --- | --- |
| SQLite | `sqlite:////data/ticketing.db` (Docker default) |
| PostgreSQL | `postgresql+psycopg://ticketing:password@postgres:5432/ticketing` |
| MySQL | `mysql+pymysql://ticketing:password@mysql-host:3306/ticketing?charset=utf8mb4` |

For a bundled PostgreSQL container, set `POSTGRES_PASSWORD` and `DATABASE_URL=postgresql+psycopg://ticketing:<password>@postgres:5432/ticketing` in `.env`, then start with `docker compose -p ticketing-prod -f docker-compose.yml --profile postgres up --build -d`. For external PostgreSQL or MySQL, create the database first and set `DATABASE_URL` to its connection URL. URL-encode special password characters. Alembic applies pending migrations when the API container starts. Local development runs Alembic during `make dev`; schema changes should be added as Alembic revisions, not created at application startup. When choosing a non-SQLite database locally, use a database hostname reachable from the host, not a Compose-only service name.

## Using the app

- The admin creates tenants and tenant users. Each user signs in with their own email and password; tenant users can only see and change their tenant's records.
- In a tenant workspace, add master fields (text, number, date, boolean, select, free-form string array, or file), then create steps and attach the fields each step needs. Mark fields required where appropriate. Array fields accept any number of individually entered string values and export as comma-separated cells; only select fields use configured options.
- Manage shared Issue records and supporting file attachments from **Issues**. Each issue has a name, description and status: Identified, Progress fixing, Fixed, or Recurring. Recurring is triggered automatically when a Fixed issue is selected again, and can then be edited back to an active status such as Progress fixing. A tenant can create one Issue-type master field and attach it to workflow steps (at most one Issue field per step). The selected issue is stored directly on the ticket and persists across steps, even when a step does not show the selector. Setting an issue to Fixed closes its open, non-deleted tickets in place and adds a closure event; reopening is blocked while that issue remains Fixed. Issues referenced by tickets cannot be deleted. No workflow steps are created or changed by issue records.
- Tenant users can set a workspace display name and upload or remove a PNG, JPEG, or WebP icon in **Settings**. The image is normalized to a 256×256 WebP icon and served only to authenticated users from that same tenant. This display branding does not change the platform-managed tenant name or slug.
- Each tenant receives a tenant-scoped API key when provisioned. The admin dashboard reveals it once at creation and allows rotation; rotating invalidates old file links and integrations. File fields upload to tenant-owned storage and return a file access URL authorized by that tenant key. Excel exports use absolute file links based on the incoming host and forwarded protocol, so the links resolve from the exported workbook. API-key links include the key in the query string: treat them as secrets and avoid posting them publicly. The `MAX_UPLOAD_BYTES` setting defaults to 25 MiB. Docker stores uploads in the persistent `upload_data` volume. Tenants created before API keys were added should have an admin rotate their key once before creating file links.
- In **Settings**, set the label for the ticket-level identifier (for example, “Nama Perusahaan”). Every new ticket requires an identifier, independent of its step. Identifiers can repeat; the numeric ticket ID is unique. A title is generated from the identifier and follows edits unless a user chooses **Customize title**; **Use automatic title** resets it. Existing tickets are backfilled with their previous titles as identifiers on upgrade.
- Create a ticket at any step. Move open tickets to any other step; its identifier remains available, shared step-field values carry forward, new required fields must be completed, and fields absent from the next step remain in the activity history. Tickets can close at any step and can be reopened unless soft-deleted; each close and reopen is retained in the activity timeline.
- Filter the ticket table by multiple current steps, status, and identifier text. **Export Excel** exports every matching ticket with its identifier, regardless of the current table page. Lists default to newest first and offer limits of 10, 20, 50, or 100.
- Overviews provide 7-, 30-, and 90-day charts for ticket lifecycle activity; tenant users also see ticket totals by their own steps. The platform view uses server-aggregated totals and account growth and does not return tenant names, individual tenant series, ticket identifiers, or ticket details.
- Deletion is soft deletion. Deleting a tenant disables access for its users without erasing ticket history. Steps used by tickets and fields used by active step configurations cannot be deleted.

## Seed StelinaCS reports

The provided dataset is in `backend/data/stelinacs_seed.json`. It provisions the `StelinaCS` tenant, user `stelinacs1@stelina.co.id`, six issue-category steps, NIB/No Aju/No PIB fields on each step, and 31 tickets assigned to their matching issue step. Issue type is represented by the ticket's workflow step rather than an extra “Jenis Kendala” ticket field. PIB/NIB/Aju values are kept as strings so leading zeroes are preserved. Re-running the seed reuses tickets and moves any previous seed tickets from the legacy single step to their matching category steps.

Set `STELINACS_PASSWORD` to the requested account password and run `make seed-stelinacs` from the repository root. In PowerShell: `$env:STELINACS_PASSWORD = '<the supplied password>'; make seed-stelinacs`. On macOS/Linux: `STELINACS_PASSWORD='<the supplied password>' make seed-stelinacs`. The command applies pending migrations first. It prints the tenant API key once when it creates the tenant; copy and store that key securely. The password is hashed and is not stored in the seed JSON.

## Local development

Use Python 3.12+ and Node 22+. Set `APP_SECRET` to a long random value, then run:

```sh
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m app.cli generate-key
python -m uvicorn app.main:app --reload
```

In another shell:

```sh
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to port 8000. For verification, run `python -m pytest` in `backend` and `npm run build` in `frontend`.
