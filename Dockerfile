FROM golang:1.26 AS build
WORKDIR /app
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY . .
RUN go build -C server -o orchestrator .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/kubectl https://dl.k8s.io/release/v1.36.0/bin/linux/amd64/kubectl \
    && chmod +x /usr/local/bin/kubectl
WORKDIR /app
COPY --from=build /app/server/orchestrator ./server/orchestrator
COPY restaurantmenuchanges.csv ./restaurantmenuchanges.csv
EXPOSE 8080
CMD ["./server/orchestrator"]
