# r3ydan.ee on Fly.io: the static site served by nginx (see nginx.conf, fly.toml).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
RUN rm /usr/share/nginx/html/nginx.conf
