#!/usr/bin/env bash
#
# Manage the single shared MongoDB container. wslc has no compose support, so this script
# plays that role. Names and ports come from instance.js.
#
# One container serves every instance; instances are isolated by database name.
# See docs/DEV_DATABASE.md.
#
# Usage: scripts/dev-db.sh <up|down [--server]|reset|status|logs|doctor|migrate|nuke-all>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_IMAGE="${AUTOTASKCALENDAR_MONGO_IMAGE:-mongo:latest}"
READINESS_TIMEOUT_SECONDS=60
# The shared container is host-wide, so the lock must be too.
LOCK_FILE="${TMPDIR:-/tmp}/autotaskcalendar-mongo.lock"
CREATE_ATTEMPTS=3

if ! command -v wslc >/dev/null 2>&1; then
    echo "error: 'wslc' not found on PATH. It is required to run the dev database." >&2
    exit 1
fi

cd "$REPO_ROOT"

# Read the resolved instance descriptor from instance.js, the single source of truth.
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

# Extract the "Name" field from wslc's JSON output.
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

# Everything left over from the old one-container-per-instance scheme.
legacy_containers() {
    wslc_clean list --all --format json | json_names \
        | grep '^autotaskcalendar-mongo-' | grep -Fxv "$CONTAINER_NAME" || true
}

legacy_volumes() {
    wslc_clean volume list --format json | json_names \
        | grep '^autotaskcalendar-mongo-data-' | grep -Fxv "$VOLUME_NAME" || true
}

# Run a real MongoDB command through the host port-forward.
#
# A stale wslc forward can accept TCP while dropping every MongoDB handshake, so a socket
# probe and an in-container ping are not enough. This checks the exact route the app uses.
mongo_ping() {
    AUTOTASKCALENDAR_HEALTHCHECK_URL="$MONGO_URL" node - <<'NODE' >/dev/null 2>&1
const mongoose = require('mongoose');

(async () => {
    try {
        await mongoose.connect(process.env.AUTOTASKCALENDAR_HEALTHCHECK_URL, {
            serverSelectionTimeoutMS: 2_000,
            connectTimeoutMS: 2_000,
            socketTimeoutMS: 2_000,
            maxPoolSize: 1,
        });
        await mongoose.connection.db.admin().ping();
        await mongoose.connection.close();
    } catch (error) {
        await mongoose.connection.close().catch(() => {});
        process.exitCode = 1;
    }
})();
NODE
}

# Block until mongod answers through the published port.
wait_for_ready() {
    local deadline=$((SECONDS + READINESS_TIMEOUT_SECONDS))

    while (( SECONDS < deadline )); do
        if mongo_ping; then
            return 0
        fi
        sleep 1
    done

    return 1
}

create_container() {
    if ! volume_exists; then
        echo "Creating shared volume '$VOLUME_NAME'..."
        wslc volume create "$VOLUME_NAME" >/dev/null
    fi

    echo "Creating shared container '$CONTAINER_NAME' on port $MONGO_PORT..."
    wslc run -d \
        --name "$CONTAINER_NAME" \
        --label "$CONTAINER_LABEL" \
        -p "${MONGO_PORT}:27017" \
        -v "${VOLUME_NAME}:/data/db" \
        "$MONGO_IMAGE" >/dev/null
}

remove_container() {
    wslc stop "$CONTAINER_NAME" >/dev/null 2>&1 </dev/null || true
    wslc remove "$CONTAINER_NAME" >/dev/null 2>&1 </dev/null || true
}

ready_failure() {
    echo "error: shared mongo container '$CONTAINER_NAME' did not become reachable on 127.0.0.1:${MONGO_PORT} in ${READINESS_TIMEOUT_SECONDS}s." >&2
    echo "       Inspect it with: scripts/dev-db.sh logs" >&2
    echo "       Or start over with: scripts/dev-db.sh nuke-all && scripts/dev-db.sh up" >&2
    return 1
}

# Ensure the one shared container exists and actually answers MongoDB through the forward.
ensure_up() {
    if container_running && mongo_ping; then
        echo "mongo already healthy at $MONGO_URL"
        return 0
    fi

    if container_running; then
        # "Running" is not the same as reachable: the host port-forward can die while the
        # container stays up, and every caller reaches mongo through that forward.
        echo "Container is running but its published Mongo connection is stale; restarting..."
        wslc stop "$CONTAINER_NAME" >/dev/null 2>&1 </dev/null || true
    fi

    local attempt
    for (( attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++ )); do
        if container_exists; then
            echo "Starting shared container '$CONTAINER_NAME'..."
            wslc start "$CONTAINER_NAME" >/dev/null 2>&1 </dev/null || true
        else
            create_container
        fi

        if wait_for_ready; then
            echo "mongo ready at $MONGO_URL"
            return 0
        fi

        echo "Attempt $attempt/$CREATE_ATTEMPTS failed; recreating the container..." >&2
        remove_container
        sleep $(( attempt * 2 ))
    done

    ready_failure
}

cmd_up() {
    # Several worktrees may race to create the one shared container; serialize them.
    if command -v flock >/dev/null 2>&1; then
        exec 9>"$LOCK_FILE"
        flock 9
    fi

    ensure_up
}

# Drop just this instance's database. The shared server keeps serving everyone else.
drop_database() {
    AUTOTASKCALENDAR_DROP_URL="$MONGO_URL" node - <<'NODE'
const mongoose = require('mongoose');

(async () => {
    try {
        await mongoose.connect(process.env.AUTOTASKCALENDAR_DROP_URL, {
            serverSelectionTimeoutMS: 5_000,
            maxPoolSize: 1,
        });
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
    } catch (error) {
        await mongoose.connection.close().catch(() => {});
        console.error(`error: could not drop database: ${error.message}`);
        process.exitCode = 1;
    }
})();
NODE
}

cmd_down() {
    if [[ "${1:-}" == "--server" ]]; then
        if container_exists; then
            echo "warning: this stops MongoDB for every instance on this host."
            echo "Stopping shared container '$CONTAINER_NAME' (data volume kept)..."
            wslc stop "$CONTAINER_NAME" >/dev/null 2>&1 </dev/null || true
            echo "Stopped."
        else
            echo "No shared container exists."
        fi
        return 0
    fi

    if ! container_running; then
        echo "Shared container is not running; nothing to drop."
        return 0
    fi

    echo "Dropping database '$DB_NAME'..."
    drop_database
    echo "Dropped. The shared container is left running for other instances."
    echo "Use 'scripts/dev-db.sh down --server' to stop MongoDB for everyone."
}

cmd_reset() {
    cmd_up
    echo "Dropping database '$DB_NAME'..."
    drop_database
    echo "Database '$DB_NAME' is empty. Run 'npm run seed' to repopulate it."
}

# List the autotaskcalendar_* databases in the shared server with their sizes.
list_databases() {
    AUTOTASKCALENDAR_LIST_URL="$MONGO_URL" node - <<'NODE' 2>/dev/null || true
const mongoose = require('mongoose');

(async () => {
    try {
        await mongoose.connect(process.env.AUTOTASKCALENDAR_LIST_URL, {
            serverSelectionTimeoutMS: 3_000,
            maxPoolSize: 1,
        });
        const { databases } = await mongoose.connection.db.admin().listDatabases();
        for (const db of databases.filter(d => d.name.startsWith('autotaskcalendar_'))) {
            const mb = (Number(db.sizeOnDisk || 0) / 1024 / 1024).toFixed(1);
            console.log(`  ${db.name.padEnd(50)} ${mb} MB`);
        }
        await mongoose.connection.close();
    } catch {
        await mongoose.connection.close().catch(() => {});
    }
})();
NODE
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
    printf 'container     %s (%s, shared by all instances)\n' "$CONTAINER_NAME" "$state"
    printf 'volume        %s\n' "$VOLUME_NAME"

    if [[ "$state" == "running" ]]; then
        echo 'databases'
        list_databases
    fi
}

cmd_logs() {
    wslc logs -f "$CONTAINER_NAME"
}

# Report on the shared container and flag anything left over from the old scheme.
cmd_doctor() {
    local state="not created" reachable="-" legacy_c legacy_v

    if container_running; then
        state="running"
        if mongo_ping; then
            reachable="mongo handshake ok on ${MONGO_PORT}"
        else
            reachable="UNREACHABLE on ${MONGO_PORT} (run: scripts/dev-db.sh up)"
        fi
    elif container_exists; then
        state="stopped"
    fi

    printf '%-20s %s\n' 'shared container' "$CONTAINER_NAME"
    printf '%-20s %s\n' 'state' "$state"
    printf '%-20s %s\n' 'connectivity' "$reachable"

    legacy_c="$(legacy_containers)"
    legacy_v="$(legacy_volumes)"

    if [[ -n "$legacy_c" || -n "$legacy_v" ]]; then
        echo
        echo "warning: containers/volumes from the old one-per-instance scheme are still here."
        echo "         Each running one holds a wslc port-forward, and too many of those start"
        echo "         resetting connections mid-run. Remove them with:"
        echo "           npm run db:migrate"
        echo
        [[ -n "$legacy_c" ]] && echo "$legacy_c" | sed 's/^/  container  /'
        [[ -n "$legacy_v" ]] && echo "$legacy_v" | sed 's/^/  volume     /'
    else
        echo
        echo "No legacy per-instance containers or volumes. Exactly one mongo container."
    fi
}

# Remove everything from the old one-container-per-instance scheme.
cmd_migrate() {
    local containers volumes count=0

    containers="$(legacy_containers)"
    volumes="$(legacy_volumes)"

    for container in $containers; do
        echo "Removing legacy container $container..."
        wslc stop "$container" >/dev/null 2>&1 </dev/null || true
        wslc remove "$container" >/dev/null 2>&1 </dev/null || true
        count=$((count + 1))
    done

    for volume in $volumes; do
        echo "Removing legacy volume $volume..."
        wslc volume remove "$volume" >/dev/null 2>&1 </dev/null || true
        count=$((count + 1))
    done

    if (( count == 0 )); then
        echo "Nothing to migrate; only the shared container is in use."
        return 0
    fi

    echo "Removed $count legacy object(s). Old data is gone; run 'npm run seed' to repopulate."
}

# Tear down the shared container and volume, plus any legacy leftovers.
cmd_nuke_all() {
    echo "Removing shared container and volume..."
    remove_container
    wslc volume remove "$VOLUME_NAME" >/dev/null 2>&1 </dev/null || true
    cmd_migrate
    echo "All AutoTaskCalendar containers and volumes removed."
}

case "${1:-}" in
    up)       cmd_up ;;
    down)     shift; cmd_down "${1:-}" ;;
    reset)    cmd_reset ;;
    status)   cmd_status ;;
    logs)     cmd_logs ;;
    doctor)   cmd_doctor ;;
    migrate)  cmd_migrate ;;
    gc)       echo "'gc' is gone: there is only one mongo container now. Use 'npm run db:migrate' to clean up old ones." ;;
    nuke-all) cmd_nuke_all ;;
    *)
        echo "Usage: scripts/dev-db.sh <up|down [--server]|reset|status|logs|doctor|migrate|nuke-all>" >&2
        exit 1
        ;;
esac
