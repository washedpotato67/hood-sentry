#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: infra/smoke-test.sh WEB_URL API_URL" >&2
  exit 2
fi

web_url=${1%/}
api_url=${2%/}

case "$web_url" in
  https://* | http://localhost:* | http://127.0.0.1:*) ;;
  *)
    echo "WEB_URL must use HTTPS outside localhost." >&2
    exit 2
    ;;
esac

case "$api_url" in
  https://* | http://localhost:* | http://127.0.0.1:*) ;;
  *)
    echo "API_URL must use HTTPS outside localhost." >&2
    exit 2
    ;;
esac

curl --fail --silent --show-error --retry 3 --max-time 20 "$api_url/health/live" \
  | jq -e '.status == "ok"' >/dev/null
curl --fail --silent --show-error --retry 3 --max-time 30 "$api_url/health/ready" \
  | jq -e '.status == "ready"' >/dev/null
curl --fail --silent --show-error --retry 3 --max-time 30 "$web_url" \
  | grep -Fq '<title>Hood Sentry</title>'

echo "Deployment smoke checks passed."

