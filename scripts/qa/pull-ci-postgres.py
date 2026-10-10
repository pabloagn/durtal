#!/usr/bin/env python3
"""Install postgres:16 on the GitHub Linux/X64 runner, anonymously and boundedly.

Local test-local.py behavior is unchanged. The ECR Public fallback must match
Docker Hub's current index digest before pulling the amd64 child by digest.
"""

import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

HUB = "registry-1.docker.io"
MIRROR = "public.ecr.aws"
REPOSITORY = "docker/library/postgres"
ACCEPT = ", ".join(("application/vnd.oci.image.index.v1+json",
                    "application/vnd.docker.distribution.manifest.list.v2+json",
                    "application/vnd.oci.image.manifest.v1+json",
                    "application/vnd.docker.distribution.manifest.v2+json"))
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


class PullFailure(RuntimeError):
    def __init__(self, kind):
        super().__init__(f"Image pull failed ({kind})")
        self.kind = kind


def digest(body):
    return "sha256:" + hashlib.sha256(body).hexdigest()


def classify(output):
    value = output.lower()
    if (any(term in value for term in ("toomanyrequests", "too many requests", "pull rate limit"))
            or re.search(r"\b429\b", value)):
        return "quota"
    if (any(term in value for term in ("timeout", "timed out", "connection reset", "connection refused",
                                       "temporary failure", "tls handshake", "unexpected eof",
                                       "bad gateway", "service unavailable", "internal server error"))
            or re.search(r"\b(?:500|502|503|504)\s+(?:internal|bad|service|gateway)", value)):
        return "transient"
    return "terminal"


def pull(run, reference, sleep=time.sleep):
    for attempt in range(3):
        try:
            run("pull", "--platform", "linux/amd64", reference)
            return
        except PullFailure as exc:
            if exc.kind != "transient" or attempt == 2:
                raise
            print(f"Transient pull failure; retry {attempt + 1}/2", flush=True)
            sleep((5, 15)[attempt])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Registry:
    def __init__(self):
        # Anonymous tokens exist only in memory; no Docker/AWS login or owner config.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.tokens = {}

    def request(self, url, method="GET", token=None, limit=1024 * 1024):
        headers = {"Accept": ACCEPT}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, headers=headers, method=method)
        # No metadata retries: unverifiable provenance fails closed.
        with self.opener.open(request, timeout=15) as response:
            body = response.read(limit + 1)
            if len(body) > limit:
                raise RuntimeError("Registry response exceeds bound")
            return body, response.headers.get("Docker-Content-Digest")

    def manifest(self, registry, repository, reference, method="GET"):
        if registry not in self.tokens:
            url = ("https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull"
                   if registry == HUB else
                   "https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository:docker/library/postgres:pull")
            body, _ = self.request(url, limit=65536)
            token = json.loads(body).get("token")
            if not isinstance(token, str) or not token or len(token) > 32768:
                raise RuntimeError("Invalid anonymous registry token")
            self.tokens[registry] = token
        return self.request(f"https://{registry}/v2/{repository}/manifests/{reference}",
                            method, self.tokens[registry])


def verified_json(body, expected, header):
    if not DIGEST.fullmatch(expected or "") or digest(body) != expected:
        raise RuntimeError("Manifest content digest mismatch")
    # ECR omits this optional header on GET; the computed digest is authoritative.
    if header is not None and header != expected:
        raise RuntimeError("Manifest header digest mismatch")
    value = json.loads(body)
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        raise RuntimeError("Unsupported manifest schema")
    return value


def descriptor(value):
    if (not isinstance(value, dict) or not isinstance(value.get("digest"), str)
            or not DIGEST.fullmatch(value["digest"])
            or type(value.get("size")) is not int or value["size"] <= 0):
        raise RuntimeError("Invalid manifest descriptor")
    return value


def equivalent_mirror(registry):
    # Docker documents HEAD version checks as exempt from pull quota.
    _, current = registry.manifest(HUB, "library/postgres", "16", "HEAD")
    body, header = registry.manifest(MIRROR, REPOSITORY, "16")
    index = verified_json(body, current, header)
    if index.get("mediaType") not in ("application/vnd.oci.image.index.v1+json",
                                      "application/vnd.docker.distribution.manifest.list.v2+json"):
        raise RuntimeError("Expected a multi-platform image index")
    entries = index.get("manifests")
    if not isinstance(entries, list) or len(entries) > 128:
        raise RuntimeError("Invalid platform index")
    matches = [entry for entry in entries if isinstance(entry, dict)
               and entry.get("platform") == {"architecture": "amd64", "os": "linux"}]
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one Linux/amd64 manifest")
    child = descriptor(matches[0])
    body, header = registry.manifest(MIRROR, REPOSITORY, child["digest"])
    manifest = verified_json(body, child["digest"], header)
    if len(body) != child["size"] or manifest.get("mediaType") not in (
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.v2+json"):
        raise RuntimeError("Invalid platform manifest")
    descriptor(manifest.get("config"))
    layers = manifest.get("layers")
    if not isinstance(layers, list) or not 1 <= len(layers) <= 128:
        raise RuntimeError("Invalid image layers")
    for layer in layers:
        descriptor(layer)
    # Refuse tag movement during comparison rather than using stale equality.
    _, after = registry.manifest(HUB, "library/postgres", "16", "HEAD")
    if after != current:
        raise RuntimeError("Docker Hub tag changed during comparison")
    print(f"Verified ECR mirror: index={current} linux/amd64={child['digest']}", flush=True)
    return f"{MIRROR}/{REPOSITORY}@{child['digest']}"


def inspect(run, reference):
    value = json.loads(run("image", "inspect", reference))
    if (not isinstance(value, list) or len(value) != 1 or value[0].get("Os") != "linux"
            or value[0].get("Architecture") != "amd64" or not DIGEST.fullmatch(value[0].get("Id", ""))):
        raise RuntimeError("Expected one local Linux/amd64 image")
    return value[0]["Id"]


def install(run, registry, sleep=time.sleep):
    try:
        pull(run, "postgres:16", sleep)
    except PullFailure as exc:
        if exc.kind not in ("quota", "transient"):
            raise
        print("Primary pull unavailable; verifying official public mirror", flush=True)
        reference = equivalent_mirror(registry)
        pull(run, reference, sleep)
        installed = inspect(run, reference)
        run("tag", reference, "postgres:16")
        if inspect(run, "postgres:16") != installed:
            raise RuntimeError("Local postgres:16 tag does not match pulled image")
        return
    inspect(run, "postgres:16")


class Docker:
    def __init__(self, config):
        self.prefix = ["docker", "--config", config, "--host", "unix:///var/run/docker.sock"]
        self.env = {"PATH": os.environ["PATH"], "HOME": config, "DOCKER_CONFIG": config}

    def __call__(self, *args):
        # File-backed output avoids unbounded pipe memory. Print only fixed statuses.
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen([*self.prefix, *args], env=self.env, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = child.wait(timeout=180 if args[0] == "pull" else 15)
            except BaseException as exc:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=5)
                if isinstance(exc, subprocess.TimeoutExpired) and args[0] == "pull":
                    raise PullFailure("transient") from None
                raise
            output.seek(0, os.SEEK_END)
            size = output.tell()
            if size > 1024 * 1024:
                raise RuntimeError("Docker output exceeds bound")
            output.seek(0)
            result = output.read().decode("utf-8", errors="replace")
        if code:
            if args[0] == "pull":
                raise PullFailure(classify(result))
            raise RuntimeError("Docker image operation failed")
        return result


def main():
    if (os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux"
            or os.environ.get("RUNNER_ARCH") != "X64" or sys.platform != "linux"):
        raise RuntimeError("This installer runs only on the GitHub Linux/X64 CI runner")

    def interrupted(_signum, _frame):
        raise RuntimeError("CI image preparation interrupted")

    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix="durtal-ci-docker-") as config:
        install(Docker(config), Registry())
    print("postgres:16 ready for the unchanged full test runner", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never expose anonymous tokens, registry response bodies or raw process output.
        reason = str(exc) if type(exc) is RuntimeError or isinstance(exc, PullFailure) else type(exc).__name__
        print(f"CI PostgreSQL preparation failed ({reason}); full tests cannot start", file=sys.stderr)
        raise SystemExit(1)
