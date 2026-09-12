.PHONY: help install test test-integration lint typecheck build clean verify migrate doctor bundle release

help:  ## Show this help
	@echo "Unifia Workbench - Makefile"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) 2>/dev/null | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install:  ## Install dependencies
	bun install

test:  ## Run unit tests per package
	@echo "⚠️  Run from package dirs, not root (AGENTS.md)"
	@echo "  cd packages/unifia && bun test"
	@echo "  cd packages/contracts && bun test"

test-integration:  ## Run integration tests (bash functional)
	bash tests/integration/run-all.sh

lint:  ## Lint code with biome
	@if [ -d node_modules ]; then \
		bun x biome@latest check .; \
	else \
		echo "⚠️  Run 'bun install' first"; \
	fi

typecheck:  ## TypeScript check (per package)
	@echo "⚠️  Run from package dirs, not root"
	@echo "  cd packages/contracts && bunx tsc --noEmit"

build:  ## Build all packages
	bun turbo build

clean:  ## Clean build artifacts
	rm -rf .turbo dist build target node_modules/.cache

verify:  ## Verify installation (unifia-verify.sh)
	bash scripts/unifia-verify.sh

migrate:  ## Migrate from opencode to unifia (dry-run by default)
	@if [ "$(filter)" = "apply" ]; then \
		bash scripts/unifia-migrate.sh --apply; \
	else \
		bash scripts/unifia-migrate.sh --dry-run; \
	fi

doctor:  ## Run diagnostic tool
	bash scripts/unifia-doctor.sh

bundle:  ## Create handoff bundle
	@mkdir -p /opt/data/work/unifia-sandbox/handoff
	git bundle create /opt/data/work/unifia-sandbox/handoff/unifia-agent-result.bundle agent/integration
	git format-patch --output-directory /opt/data/work/unifia-sandbox/handoff/patches/ 207ff452..agent/integration
	@echo "Bundle created: /opt/data/work/unifia-sandbox/handoff/unifia-agent-result.bundle"
	@echo "Patches: $(ls /opt/data/work/unifia-sandbox/handoff/patches/ | wc -l)"

release:  ## Prepare release (run all checks)
	@echo "Running all checks before release..."
	bash tests/integration/run-all.sh
	bash scripts/unifia-verify.sh
	bash scripts/unifia-doctor.sh
	@echo "✅ All checks PASSED. Ready for release."
	@echo "See RELEASE-GUIDE.md for release steps."

# Filter target for migrate
filter = dry-run
