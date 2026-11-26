# StaxSync development and test image.
#
# One image for everything: Node.js plus the Playwright browsers (Chromium, Firefox, WebKit).
# Project dependencies are installed into the image at /work/node_modules. The repository is
# bind-mounted at /work/repo at run time, so Node's module resolution walks up from
# /work/repo/apps/web and finds them without writing node_modules into the workspace.
#
# Use ./dev.sh rather than calling docker directly (it builds the image when needed and runs
# every command as your own user, so files it creates stay yours).

FROM mcr.microsoft.com/playwright:v1.65.1-noble

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PATH=/work/node_modules/.bin:$PATH \
    VITE_CACHE_DIR=/tmp/vite-cache

WORKDIR /work
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --ignore-scripts \
 && chmod -R a+rX /work

WORKDIR /work/repo/apps/web
EXPOSE 5173 4173
CMD ["npm", "run", "dev"]
