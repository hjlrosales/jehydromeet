#!/bin/sh
# Jehydro Meet — Coturn Docker Entrypoint
# Substitutes environment variables in the coturn config file
# before starting the TURN server.
#
# Uses a temp file copy so the original config can remain
# mounted read-only in Docker.

set -e

CONFIG_SRC="/etc/coturn/turnserver.conf"
CONFIG_DST="/tmp/turnserver.conf"

# Copy config to writable temp location
cp "$CONFIG_SRC" "$CONFIG_DST"

# Substitute TURN_SECRET placeholder in the temp config
if [ -n "$TURN_SECRET" ]; then
  # Use | as sed delimiter to avoid issues with / in secret values
  sed -i "s|\${TURN_SECRET}|$TURN_SECRET|g" "$CONFIG_DST"
  echo "[entrypoint] TURN_SECRET substituted in config"
else
  echo "[entrypoint] WARNING: TURN_SECRET is not set. TURN authentication will not work."
fi

# Start coturn with the modified config
exec turnserver -c "$CONFIG_DST" "$@"
