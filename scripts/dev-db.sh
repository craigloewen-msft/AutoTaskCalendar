#!/usr/bin/env bash
#
# Manage the per-instance MongoDB container. wslc has no compose support, so this script
# plays that role. Names and ports come from instance.js.
#
# Usage: scripts/dev-db.sh <up|down|reset|status|logs|nuke-all>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_IMAGE="${AUTOTASKCALENDAR_MONGO_IMAGE:-mongo:latest}"
READINESS_TIMEOUT_SECONDS=60

if ! command -v wslc >/dev/null 2>&1; then
    echo "error: 'wslc' not found on PATH. It is required to run the dev database." >&2
    exit 1
fi

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

# Is the published port accepting connections on the host?
#
# Retries a few times: under load a single probe can be refused spuriously, and treating
# that as a dead forward would restart a perfectly healthy container.
port_open() {
    local attempt
    for attempt in 1 2 3; do
        if (exec 3<>"/dev/tcp/127.0.0.1/${MONGO_PORT}") >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# Block until mongod answers THROUGH THE PUBLISHED PORT.
#
# Probing inside the container proves mongod is alive but says nothing about the host
# port-forward, which can die while the container still reports "running". Everything talks
# to the database over 127.0.0.1:$MONGO_PORT, so that is what has to be verified.
wait_for_ready() {
    local deadline=$((SECONDS + READINESS_TIMEOUT_SECONDS))

    while (( SECONDS < deadline )); do
        if port_open && wslc exec "$CONTAINER_NAME" mongosh --quiet --eval 'db.adminCommand("ping")' \
            >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done

    echo "error: mongo container '$CONTAINER_NAME' did not become reachable on \
127.0.0.1:${MONGO_PORT} in ${READINESS_TIMEOUT_SECONDS}s." >&2
    echo "       Inspect it with: scripts/dev-db.sh logs" >&2
    return 1
}

cmd_up() {
    if container_running; then
        # "Running" is not the same as reachable: the host port-forward can die while the
        # container stays up, and every caller reaches mongo through that forward.
        if port_open; then
            echo "mongo already running for instance '$INSTANCE_NAME' on port $MONGO_PORT"
            return 0
        fi

        echo "Container '$CONTAINER_NAME' is running but port $MONGO_PORT is refused; restarting it..."
        wslc stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
        wslc start "$CONTAINER_NAME" >/dev/null
        wait_for_ready
        echo "mongo ready for instance '$INSTANCE_NAME' at $MONGO_URL"
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

# Tear down every instance, not just the current one.
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

# Emit "name<TAB>state<TAB>hostPort" for every AutoTaskCalendar mongo container.
# State 2 is running in wslc's JSON.
container_report() {
    wslc_clean list --all --format json | node -e '
        let raw = "";
        process.stdin.on("data", chunk => raw += chunk);
        process.stdin.on("end", () => {
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return;
                for (const entry of parsed) {
                    if (!entry || !entry.Name) continue;
                    if (!entry.Name.startsWith("autotaskcalendar-mongo-")) continue;
                    const port = (entry.Ports || [])[0];
                    const state = entry.State === 2 ? "running" : "stopped";
                    console.log([entry.Name, state, port ? port.HostPort : ""].join("\t"));
                }
            } catch {
                // No containers yet, or unparseable output: treat as empty.
            }
        });
    '
}

# Report on every AutoTaskCalendar mongo container, and whether its port actually answers.
#
# Each running container holds a wslc port-forward. Enough of them and the forwards start
# resetting connections mid-run, which shows up as MongoNetworkError/MongoPoolClearedError
# in whichever test was unlucky. This is the tool for spotting that.
cmd_doctor() {
    local report running=0 stopped=0
    report="$(container_report)"

    if [[ -z "$report" ]]; then
        echo "No AutoTaskCalendar mongo containers exist."
        return 0
    fi

    printf '%-58s %-9s %s\n' 'CONTAINER' 'STATE' 'PORT'
    while IFS=$'\t' read -r name state port; do
        [[ -z "$name" ]] && continue

        local reachable="-"
        if [[ "$state" == "running" ]]; then
            running=$((running + 1))
            if [[ -n "$port" ]]; then
                if (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
                    reachable="${port} ok"
                else
                    reachable="${port} REFUSED"
                fi
            fi
        else
            stopped=$((stopped + 1))
            [[ -n "$port" ]] && reachable="${port}"
        fi

        printf '%-58s %-9s %s\n' "$name" "$state" "$reachable"
    done <<< "$report"

    echo
    echo "$running running, $stopped stopped."

    if (( running > 2 )); then
        echo
        echo "warning: $running port-forwards are live at once. Under that much load they"
        echo "         start resetting connections mid-run, which looks like random test"
        echo "         failures. Free the ones you are not using:"
        echo "           scripts/dev-db.sh gc --all"
    fi
}

# Stop (but do not delete) mongo containers that are not part of this instance.
#
# Other worktrees and other agents have their own instances, so by default this only stops
# containers whose name starts with the current instance's prefix. Pass --all to stop every
# AutoTaskCalendar container except this one's, which is what you want when the host is
# short on port-forwards. Data lives in the volumes, so `up` brings any of them back.
cmd_gc() {
    local report count=0 scope="${1:-}"
    # The instance name minus a trailing "-test", so a branch's dev and test pair match.
    local prefix="autotaskcalendar-mongo-${INSTANCE_NAME%-test}"
    report="$(container_report)"

    while IFS=$'\t' read -r name state port; do
        [[ -z "$name" || "$state" != "running" ]] && continue
        [[ "$name" == "$CONTAINER_NAME" ]] && continue

        if [[ "$scope" != "--all" && "$name" != "$prefix"* ]]; then
            continue
        fi

        echo "Stopping $name..."
        # </dev/null so wslc cannot swallow the rest of the here-string feeding this loop.
        wslc stop "$name" >/dev/null 2>&1 </dev/null || true
        count=$((count + 1))
    done <<< "$report"

    if (( count == 0 )); then
        echo "Nothing to stop."
        if [[ "$scope" != "--all" ]]; then
            echo "Other branches' containers are left alone; use 'gc --all' to include them."
        fi
    else
        echo "Stopped $count container(s). Data is kept; 'up' restarts any of them."
    fi
}

case "${1:-}" in
    up)       cmd_up ;;
    down)     cmd_down ;;
    reset)    cmd_reset ;;
    status)   cmd_status ;;
    logs)     cmd_logs ;;
    doctor)   cmd_doctor ;;
    gc)       shift; cmd_gc "${1:-}" ;;
    nuke-all) cmd_nuke_all ;;
    *)
        echo "Usage: scripts/dev-db.sh <up|down|reset|status|logs|doctor|gc [--all]|nuke-all>" >&2
        exit 1
        ;;
esac
