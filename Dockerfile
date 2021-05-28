FROM node:14-alpine as build
ARG ENVIRONMENT="live"
WORKDIR /usr/local/app
COPY ./ .
RUN npm install
RUN npm run build:${ENVIRONMENT}

FROM nginx:alpine
COPY --from=build /usr/local/app/dist/nano-vote-visualizer /usr/share/nginx/html
EXPOSE 80
