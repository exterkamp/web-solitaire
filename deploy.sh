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

# Two speeds, because they are for two different things.
#
#   ./deploy.sh          production build - minified, hashed, what goes public
#   ./deploy.sh --fast   development build - no minifier
#   ./deploy.sh --now    no build at all - ship whatever is in dist/
#
# Measured on this machine, which is a slow one for this and is the machine
# that matters: production build 13 minutes, development build 6, and the
# container step 15 seconds. The build is the whole cost; Docker is noise.
#
# Which is what --now is for. Leave a watcher running in another terminal:
#
#   npm run watch        rebuilds dist/ on save, about 85s a change here
#   ./deploy.sh --now    and this ships it in fifteen seconds
#
# That is the loop to use while somebody is waiting with a phone in their
# hand. Finish with a plain ./deploy.sh so the public site gets a minified,
# content-hashed build rather than a development one.
mode=${1:-}
started=$SECONDS

# Both build paths go through npm scripts that cap Node's heap - see
# package.json. Node otherwise sizes it from the machine's total memory,
# which on this host is how a build takes everything else down with it: the
# daemon has stopped three times mid-build, taking Traefik and the tunnel
# with it, and the third time the build was not even inside Docker.
if [ "$mode" = "--now" ]; then
  [ -d dist/web-solitaire/browser ] || { echo "nothing built yet - run npm run build first" >&2; exit 1; }
  echo "shipping the build already in dist/"
elif [ "$mode" = "--fast" ]; then
  NODE_OPTIONS=--max-old-space-size=2048 npx ng build --configuration development
else
  npm run build
fi
built=$SECONDS

docker compose up -d --build
docker compose ps
echo
echo "build $((built - started))s, deploy $((SECONDS - built))s, total $SECONDS s"

