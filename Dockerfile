FROM node:lts
WORKDIR /project
VOLUME /var/www
COPY . /project/
RUN yarn install
