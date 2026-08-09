FROM golang:1.26 AS build
WORKDIR /app
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY . .
RUN go build -C server -o orchestrator .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/server/orchestrator ./server/orchestrator
COPY restaurantmenuchanges.csv ./restaurantmenuchanges.csv
EXPOSE 8080
CMD ["./server/orchestrator"]
