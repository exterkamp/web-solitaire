# The whole game: an Angular build on an nginx that serves it.
#
# There is no second stage for a server because there is no server. Every
# other self-hosted thing in this house is a compose file with a database
# behind it; this one is a directory of files and a router rule.
FROM node:24-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

# ngsw-config.json belongs with these: `ng build` reads it because
# angular.json names it, and without it in the image the build fails here
# while succeeding on the machine it was written on.
COPY angular.json tsconfig.json tsconfig.app.json ngsw-config.json ./
COPY src ./src
COPY public ./public
RUN npx ng build

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist/web-solitaire/browser /usr/share/nginx/html
EXPOSE 80
