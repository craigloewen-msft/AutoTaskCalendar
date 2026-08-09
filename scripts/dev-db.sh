#!/usr/bin/env bash
#
# Manage the per-instance MongoDB container for AutoTaskCalendar.
#
# Containers are run with `wslc`, which has no compose support, so this script plays the
# role docker-compose used to. Every name and port is resolved from instance.js, so this
# script and the Node app can never disagree about which database belongs to an instance.
#
# Usage: scripts/dev-db.sh <up|down|reset|status|logs|nuke-all>
#
# Set AUTOTASKCALENDAR_INSTANCE to pick an instance (default: "default").

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_IMAGE="${AUTOTASKCALENDAR_MONGO_IMAGE:-mongo:latest}"
READINESS_TIMEOUT_SECONDS=60

if ! command -v wslc >/dev/null 2>&1; then
    echo "error: 'wslc' not found on PATH. It is required to run the dev database." >&2
    exit 1
fi

# Pull the resolved instance descriptor out of instance.js. Emitting shell assignments and
# eval-ing them keeps a single source of truth for ports and names.
eval "$(node -e '
    const i = require("./instance");
    const emit = (k, v) => console.log(`${k}=${JSON.stringify(String(v))}`);
    emit("INSTANCE_NAME", i.name);
    emit("INSTANCE_OFFSET", i.offset);
    emit("API_PORT", i.apiPort);
    emit("WEB_PORT", i.webPort);
    emit("MONGO_PORT", i.mongoPort);
    emit("INSPECT_PORT", i.inspectPort);
    emit("DB_NAME", i.dbName);
    emit("MONGO_URL", i.mongoUrl);
    emit("CONTAINER_NAME", i.containerName);
    emit("VOLUME_NAME", i.volumeName);
    emit("CONTAINER_LABEL", i.containerLabel);
' 
)"

# wslc emits CRLF line endings; strip them so parsing and comparisons behave.
wslc_clean() {
    wslc "$@" 2>/dev/null | tr -d '\r'
}

# Extract the "Name" field from wslc's JSON output. Parsing JSON rather than the table
# layout keeps this robust against column-formatting changes.
json_names() {
    node -e '
        let raw = "";
        process.stdin.on("data", chunk => raw += chunk);
        process.stdin.on("end", () => {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (entry && entry.Name) console.log(entry.Name);
                    }
                }
            } catch {
                // No containers/volumes yet, or unparseable output: treat as empty.
            }
        });
    '
}

container_exists() {
    wslc_clean list --all --format json | json_names | grep -Fxq "$CONTAINER_NAME"
}

container_running() {
    wslc_clean list --format json | json_names | grep -Fxq "$CONTAINER_NAME"
}

volume_exists() {
    wslc_clean volume list --format json | json_names | grep -Fxq "$VOLUME_NAME"
}

# Block until mongod actually accepts connections. Without this, `npm run dev` races the
# container's startup and the app's first connection attempt fails.
wait_for_ready() {
    local deadline=$((SECONDS + READINESS_TIMEOUT_SECONDS))

    while (( SECONDS < deadline )); do
        if wslc exec "$CONTAINER_NAME" mongosh --quiet --eval 'db.adminCommand("ping")' \
            >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done

    echo "error: mongo container '$CONTAINER_NAME' did not become ready in \
${READINESS_TIMEOUT_SECONDS}s." >&2
    echo "       Inspect it with: scripts/dev-db.sh logs" >&2
    return 1
}

cmd_up() {
    if container_running; then
        echo "mongo already running for instance '$INSTANCE_NAME' on port $MONGO_PORT"
        return 0
    fi

    if container_exists; then
        echo "Starting existing container '$CONTAINER_NAME'..."
        wslc start "$CONTAINER_NAME" >/dev/null
    else
        if ! volume_exists; then
            echo "Creating volume '$VOLUME_NAME'..."
            wslc volume create "$VOLUME_NAME" >/dev/null
        fi

        echo "Creating container '$CONTAINER_NAME' on port $MONGO_PORT..."
        wslc run -d \
            --name "$CONTAINER_NAME" \
            --label "$CONTAINER_LABEL" \
            -p "${MONGO_PORT}:27017" \
            -v "${VOLUME_NAME}:/data/db" \
            "$MONGO_IMAGE" >/dev/null
    fi

    wait_for_ready
    echo "mongo ready for instance '$INSTANCE_NAME' at $MONGO_URL"
}

cmd_down() {
    if container_exists; then
        echo "Stopping and removing '$CONTAINER_NAME' (data volume kept)..."
        wslc stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
        wslc remove "$CONTAINER_NAME" >/dev/null
        echo "Removed."
    else
        echo "No container for instance '$INSTANCE_NAME'."
    fi
}

cmd_reset() {
    cmd_down

    if volume_exists; then
        echo "Deleting volume '$VOLUME_NAME'..."
        wslc volume remove "$VOLUME_NAME" >/dev/null
    fi

    cmd_up
}

cmd_status() {
    local state="not created"
    if container_running; then
        state="running"
    elif container_exists; then
        state="stopped"
    fi

    printf 'instance      %s (port offset %s)\n' "$INSTANCE_NAME" "$INSTANCE_OFFSET"
    printf 'web (ui)      http://localhost:%s\n' "$WEB_PORT"
    printf 'api           http://localhost:%s\n' "$API_PORT"
    printf 'debugger      %s\n' "$INSPECT_PORT"
    printf 'mongo         %s\n' "$MONGO_URL"
    printf 'database      %s\n' "$DB_NAME"
    printf 'container     %s (%s)\n' "$CONTAINER_NAME" "$state"
    printf 'volume        %s\n' "$VOLUME_NAME"
}

cmd_logs() {
    wslc logs -f "$CONTAINER_NAME"
}

# Tear down every instance, not just the current one. Handy for reclaiming a machine after
# a swarm of agents has been through it.
cmd_nuke_all() {
    local containers volumes

    containers="$(wslc_clean list --all --format json | json_names \
        | grep '^autotaskcalendar-mongo-' || true)"

    for container in $containers; do
        echo "Removing container $container..."
        wslc stop "$container" >/dev/null 2>&1 || true
        wslc remove "$container" >/dev/null 2>&1 || true
    done

    volumes="$(wslc_clean volume list --format json | json_names \
        | grep '^autotaskcalendar-mongo-data-' || true)"

    for volume in $volumes; do
        echo "Removing volume $volume..."
        wslc volume remove "$volume" >/dev/null 2>&1 || true
    done

    echo "All AutoTaskCalendar containers and volumes removed."
}

cd "$REPO_ROOT"

case "${1:-}" in
    up)       cmd_up ;;
    down)     cmd_down ;;
    reset)    cmd_reset ;;
    status)   cmd_status ;;
    logs)     cmd_logs ;;
    nuke-all) cmd_nuke_all ;;
    *)
        echo "Usage: scripts/dev-db.sh <up|down|reset|status|logs|nuke-all>" >&2
        exit 1
        ;;
esac
