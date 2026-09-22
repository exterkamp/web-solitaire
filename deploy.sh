#!/usr/bin/env bash
# Build, then serve what was built.
#
# Two steps rather than one image build, because the machine this runs on
# cannot do both at once: an Angular build inside the Docker daemon has twice
# taken enough memory to stop the daemon, and everything else on the host with
# it. Out here a build that goes wrong is just a build that goes wrong.
set -euo pipefail
cd "$(dirname "$0")"

# The Angular CLI wants a Node this shell does not have by default - the
# system node here is v17 and the build needs 24, which is what .nvmrc says.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

npm run build
docker compose up -d --build
docker compose ps
