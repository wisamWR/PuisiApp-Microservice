# Image api-gateway untuk deploy (T0.9/T10.4): config nginx dibawa di dalam
# image, sehingga EC2 cukup menarik image dari GHCR tanpa menyalin folder ini.
# Di laptop, compose dev tetap memakai nginx resmi + bind mount (ubah config
# tanpa build ulang).
#
# Build context = infra/nginx.
FROM nginx:1.28-alpine

# default.conf bawaan image ikut listen 80 dan menang sebagai server default
# (urutan abjad), sehingga semua rute gateway jadi 404. Dibuang dulu.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d /etc/nginx/conf.d
COPY routes /etc/nginx/routes
COPY common /etc/nginx/common
COPY templates /etc/nginx/templates
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1/health || exit 1

EXPOSE 80
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
