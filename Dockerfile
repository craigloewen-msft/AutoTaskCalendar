# [Choice] Node.js version (use -bullseye variants on local arm64/Apple Silicon): 18, 16, 14, 18-bullseye, 16-bullseye, 14-bullseye, 18-buster, 16-buster, 14-buster
FROM python:3.10

WORKDIR /usr/src/app

# Install Python dependencies
# RUN mkdir -p ./pythonWorker/
COPY ./pythonWorker/requirements.txt ./pythonWorker/requirements.txt
RUN pip install -r ./pythonWorker/requirements.txt

# Install Node
ENV NODE_VERSION=16.20.2
RUN apt install -y curl
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"

# Install Node packages
COPY ./package*.json ./app.js ./
RUN npm install

COPY ./webinterface/package*.json ./webinterface/
RUN cd webinterface && npm install && cd ..

# Build the project and install dependencies
#RUN npm run build

# Bring files over
COPY . . 

CMD ["node", "app.js"]