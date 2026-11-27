# The status page: Gatus with this directory's config.yaml. Railway builds it (README.md).
# Pinned by version and digest: a moved tag cannot change what runs.
FROM twinproduction/gatus:v5.38.0@sha256:085ed63da963728965d00a3c78aa6167e3bf135218485b893201758e079e8415

COPY config.yaml /config/config.yaml

# Mount the Railway volume at /data. Railway sets PORT; the image's default is 8080.
ENV GATUS_CONFIG_PATH=/config/config.yaml \
    GATUS_SQLITE_PATH=/data/gatus.db
