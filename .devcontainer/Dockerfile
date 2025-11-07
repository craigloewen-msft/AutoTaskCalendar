# Use official Node.js 24 LTS image
FROM node:24-bookworm

# Install MongoDB command line tools
ARG MONGO_TOOLS_VERSION=7.0
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-${MONGO_TOOLS_VERSION}.asc | \
    gpg -o /usr/share/keyrings/mongodb-server-${MONGO_TOOLS_VERSION}.gpg --dearmor \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${MONGO_TOOLS_VERSION}.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/${MONGO_TOOLS_VERSION} main" | \
    tee /etc/apt/sources.list.d/mongodb-org-${MONGO_TOOLS_VERSION}.list \
    && apt-get update \
    && apt-get install -y mongodb-database-tools mongodb-mongosh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# [Optional] Uncomment this section to install additional OS packages.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends sudo \
    && echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# [Optional] Uncomment if you want to install an additional version of node using nvm
# ARG EXTRA_NODE_VERSION=10
# RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${EXTRA_NODE_VERSION}"

# [Optional] Uncomment if you want to install more global node modules
# RUN su node -c "npm install -g <your-package-list-here>"

# Ensure the node user has proper permissions for the workspace
RUN mkdir -p /workspace && chown -R node:node /workspace



