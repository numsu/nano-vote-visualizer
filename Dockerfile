FROM node:14-alpine as build
WORKDIR /usr/local/app
COPY ./ .
RUN npm install
RUN npm run build

FROM nginx:alpine
COPY --from=build /usr/local/app/dist/nano-vote-visualizer /usr/share/nginx/html
EXPOSE 80
