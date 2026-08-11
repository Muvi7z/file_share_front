# Docker

The compose file runs the full stack:

- `frontend`: nginx serving the Vite/React build
- `backend`: Go API on port `5544`
- `db`: PostgreSQL

## Run

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080
```

The nginx container proxies `/api/...` to `http://backend:5544`.

## Video files

Mount your media folder with `VIDEO_LIBRARY_PATH`.

PowerShell example:

```powershell
$env:VIDEO_LIBRARY_PATH="D:\Video"
docker compose up --build
```

Inside the admin UI, add the mounted container path:

```text
/media/videos
```

Do not add a Windows path such as `D:\Video` while the backend is running inside Docker.

## Ports

- Frontend: `FRONTEND_PORT`, default `8080`
- Backend: `BACKEND_PORT`, default `5544`
- PostgreSQL host port: `POSTGRES_PORT`, default `5439`

Example:

```bash
FRONTEND_PORT=3000 BACKEND_PORT=5545 docker compose up --build
```
