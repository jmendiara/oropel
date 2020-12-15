FROM node:14.15.3-stretch

# you'll likely want the latest npm, regardless of node version, for speed and fixes
RUN npm install npm@6.14.10 -g

WORKDIR /workspace
COPY package.json package-lock.json* ./
RUN npm install

# copy in our source code last, as it changes the most
COPY . .
