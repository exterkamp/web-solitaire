# The game, served: a directory of files on an nginx.
#
# It copies a build rather than making one, and that is a deliberate step
# backwards from the multi-stage Dockerfile this used to be. Building inside
# the daemon on this host took enough memory to stop dockerd twice, and every
# container on the machine went down with it - Traefik, the tunnel, the other
# game, the lot. A build that can take the household offline is not a build
# worth having in the image.
#
# So the build happens outside, where a failure is just a failed build:
#
#   ./deploy.sh          # npm run build, then compose up
#
# The cost is that `docker compose build` alone is not self-contained: it
# needs dist/ to be current. deploy.sh is the answer to that, and the
# healthcheck below is the answer to getting it wrong - a stale dist still
# serves, it just serves yesterday's game.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/web-solitaire/browser /usr/share/nginx/html
EXPOSE 80
