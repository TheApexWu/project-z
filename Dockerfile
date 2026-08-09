FROM golang:1.26 AS build
WORKDIR /app
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY . .
RUN go build -C server -o orchestrator .

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/server/orchestrator ./server/orchestrator
COPY restaurantmenuchanges.csv ./restaurantmenuchanges.csv
EXPOSE 8080
CMD ["./server/orchestrator"]
