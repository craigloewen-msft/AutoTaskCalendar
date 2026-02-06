# Use Ubuntu as base image
FROM ubuntu:latest

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages and Node.js
ARG NODE_VERSION=24
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    sudo \
    git \
    ripgrep \
    fd-find \
    fzf \
    unzip \
    && mkdir -p /etc/apt/keyrings \
    # Add NodeSource repository for Node.js
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Create symlink for fd (Ubuntu names it fdfind)
    && ln -s $(which fdfind) /usr/local/bin/fd

# Install lazygit from GitHub releases
ARG LAZYGIT_VERSION=0.44.1
RUN curl -Lo lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz" \
    && tar xf lazygit.tar.gz lazygit \
    && install lazygit /usr/local/bin \
    && rm lazygit lazygit.tar.gz

# Install Neovim from GitHub releases (latest stable)
RUN NVIM_VERSION=$(curl -s https://api.github.com/repos/neovim/neovim/releases/latest | grep '"tag_name"' | cut -d'"' -f4) \
    && curl -Lo nvim-linux-x86_64.tar.gz "https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux-x86_64.tar.gz" \
    && tar xzf nvim-linux-x86_64.tar.gz \
    && cp -r nvim-linux-x86_64/* /usr/local/ \
    && rm -rf nvim-linux-x86_64 nvim-linux-x86_64.tar.gz

# Install MongoDB command line tools (8.0 supports Ubuntu Noble)
ARG MONGO_TOOLS_VERSION=8.0
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-${MONGO_TOOLS_VERSION}.asc | \
    gpg -o /usr/share/keyrings/mongodb-server-${MONGO_TOOLS_VERSION}.gpg --dearmor \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${MONGO_TOOLS_VERSION}.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/${MONGO_TOOLS_VERSION} multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-${MONGO_TOOLS_VERSION}.list \
    && apt-get update \
    && apt-get install -y mongodb-database-tools mongodb-mongosh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create node user (mimics the official node image)
# Handle case where UID/GID 1000 may already exist (e.g., ubuntu user)
RUN existing_user=$(getent passwd 1000 | cut -d: -f1) \
    && existing_group=$(getent group 1000 | cut -d: -f1) \
    && if [ -n "$existing_group" ] && [ "$existing_group" != "node" ]; then \
         groupmod -n node "$existing_group"; \
       elif [ -z "$existing_group" ]; then \
         groupadd --gid 1000 node; \
       fi \
    && if [ -n "$existing_user" ] && [ "$existing_user" != "node" ]; then \
         usermod -l node -d /home/node -m "$existing_user"; \
       elif [ -z "$existing_user" ]; then \
         useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home node; \
       fi \
    && echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node \
    && mkdir -p /workspace \
    && chown -R node:node /workspace
