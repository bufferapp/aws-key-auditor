FROM node:9.4.0-alpine

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ENV NODE_ENV production

COPY package.json /usr/src/app
RUN npm install

COPY index.js /usr/src/app
COPY summaryemail.html /usr/src/app
COPY reminderemail.html /usr/src/app

CMD npm start
