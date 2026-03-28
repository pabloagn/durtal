{
  pkgs,
  pkgs-unstable,
}:

pkgs.mkShell {
  name = "durtal";

  buildInputs = with pkgs; [
    # =========================================================================
    # Version Control
    # =========================================================================
    git
    git-lfs
    gh
    difftastic

    # =========================================================================
    # Node.js Environment (Primary — Next.js Application)
    # =========================================================================
    nodejs_22
    pnpm
    nodePackages.typescript

    # =========================================================================
    # Python Environment (Secondary — Ingestion Scripts)
    # =========================================================================
    python312
    uv

    # =========================================================================
    # Task Runner
    # =========================================================================
    go-task

    # =========================================================================
    # Language Servers (IDE/Editor Support)
    # =========================================================================
    nodePackages.typescript-language-server
    tailwindcss-language-server
    basedpyright
    taplo
    yaml-language-server
    nodePackages.vscode-langservers-extracted

    # =========================================================================
    # Cloud CLIs
    # =========================================================================
    awscli2

    # =========================================================================
    # Container Runtime (Development Only)
    # =========================================================================
    docker
    docker-compose
    lazydocker

    # =========================================================================
    # Database Clients
    # =========================================================================
    postgresql # psql client (Neon debugging)

    # =========================================================================
    # HTTP/API Testing
    # =========================================================================
    curl
    jq
    httpie

    # =========================================================================
    # Debugging & Profiling
    # =========================================================================
    ncdu
    htop
    hyperfine

    # =========================================================================
    # System Dependencies (for Python packages via uv)
    # =========================================================================
    libxml2
    libxslt
    zlib
    libffi
    openssl
    pkg-config

    # =========================================================================
    # AI Development Tools
    # =========================================================================
    pkgs-unstable.claude-code
    pkgs-unstable.claude-monitor
    codex
    gemini-cli
  ];

  shellHook = ''
    # Fix SSL cert discovery for uv-managed Python
    export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"

    # Strip Nix Python 3.13 site-packages from PYTHONPATH to prevent
    # ABI-incompatible libraries from shadowing .venv packages.
    export PYTHONPATH="$(echo "$PYTHONPATH" | tr ':' '\n' | grep -v 'python3\.13' | tr '\n' ':' | sed 's/:$//')"

    # Activate Python virtual environment if it exists (for ingestion scripts)
    if [ -d .venv ]; then
      source .venv/bin/activate
    fi
  '';
}
