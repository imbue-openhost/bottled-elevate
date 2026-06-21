default: test

# Install Python deps for the server.
setup:
    uv sync

# Run the backend locally on http://localhost:8080 (auto-reloads). Serves the last Angular build
# under appcore/dist/app; run `npm --prefix appcore run build -- --configuration=web` first.
run:
    OPENHOST_SQLITE_MAIN={{justfile_directory()}}/local-data/main.db \
    OPENHOST_ROUTER_URL=http://localhost \
    OPENHOST_APP_TOKEN=dev \
    ELEVATE_STATIC_DIR={{justfile_directory()}}/appcore/dist/app \
        uv run hypercorn server.app:app --bind 0.0.0.0:8080 --reload

# Run the Python test suite.
test:
    uv run pytest -x

# Lint, format, and typecheck.
check:
    uv run ruff check --fix .
    uv run ruff format .
    uv run mypy
