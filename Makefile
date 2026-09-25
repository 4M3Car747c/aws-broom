VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all web build dev test lint iam-policy docker clean

all: web build

## Build the SPA and copy it into the Go embed directory
web:
	cd web && pnpm install --frozen-lockfile && pnpm run build
	rm -rf internal/web/dist && mkdir -p internal/web/dist
	cp -R web/build/client/. internal/web/dist/
	touch internal/web/dist/.gitkeep

## Build the server binary (expects `make web` first for an embedded UI)
build:
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/broom ./cmd/broom

## Run Go API on :8080 and Vite dev server on :5173 (proxying /api)
dev:
	@echo "Starting Go API on :8080 and Vite on :5173"
	@trap 'kill 0' INT TERM; \
	  go run ./cmd/broom serve & \
	  (cd web && pnpm run dev) & \
	  wait

test:
	go test ./... -count=1
	cd web && pnpm run typecheck

lint:
	go vet ./...
	cd web && pnpm run typecheck

## Regenerate docs/iam/*.json from the cloud-nuke sources in go.mod
iam-policy:
	go run ./tools/iampolicy

docker:
	docker build --build-arg VERSION=$(VERSION) -t aws-broom:$(VERSION) .

clean:
	rm -rf bin web/build internal/web/dist/*
	touch internal/web/dist/.gitkeep
