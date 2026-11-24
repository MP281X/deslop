#!/usr/bin/env bash
# Generators read the manifests of one checkout, so two branches can each take the same next port.
set -eo pipefail
ports=$(jq -r '"\(.config.port | tojson)\t\(input_filename)"' apps/*/package.json)
failed=0
while IFS=$'\t' read -r port manifest; do
	if ! [[ $port =~ ^[1-9][0-9]{3,4}$ ]] || ((port < 1024 || port > 65535)); then
		echo "::error file=$manifest::config.port must be an integer from 1024 to 65535, not $port"
		failed=1
	fi
done <<<"$ports"
for port in $(cut -f1 <<<"$ports" | sort | uniq -d); do
	echo "::error::Default port $port is taken by $(awk -F'\t' -v port="$port" '$1 == port {print $2}' <<<"$ports" | paste -sd ' ')"
	failed=1
done
exit "$failed"
