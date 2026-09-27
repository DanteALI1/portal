# /opt/services/portal/Dockerfile
# Вариант 1 (как в ТЗ): на сервер копируется готовая папка dist/
FROM nginx:1.25-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
