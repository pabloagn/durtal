#!/usr/bin/env python3
"""Pure CI pull policy tests. Never contacts registries or runs Docker."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("ci_postgres", Path(__file__).with_name("pull-ci-postgres.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)
IMAGE_ID = "sha256:" + "1" * 64


def encode(value):
    return json.dumps(value, separators=(",", ":")).encode()


class FakeRegistry:
    def __init__(self):
        self.child = encode({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                             "config": {"digest": IMAGE_ID, "size": 10},
                             "layers": [{"digest": IMAGE_ID, "size": 20}]})
        self.entry = {"digest": ci.digest(self.child), "size": len(self.child),
                      "platform": {"architecture": "amd64", "os": "linux"}}
        self.index = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                      "manifests": [self.entry]}
        self.heads = 0
        self.drift = False
        self.corrupt_child = False
        self.mismatch = False
        self.header = None
        self.calls = []

    def manifest(self, registry, repository, reference, method="GET"):
        self.calls.append((registry, repository, reference, method))
        body = encode(self.index)
        if registry == ci.HUB:
            self.heads += 1
            digest = IMAGE_ID if self.mismatch or (self.drift and self.heads > 1) else ci.digest(body)
            return b"", digest
        if reference == "16":
            return body, self.header
        return self.child + (b"!" if self.corrupt_child else b""), None


class FakeDocker:
    def __init__(self, failures=()):
        self.failures = list(failures)
        self.calls = []
        self.arch = "amd64"
        self.tag_id = IMAGE_ID
        self.mirror_failure = False

    def __call__(self, *args):
        self.calls.append(args)
        if args[0] == "pull":
            if args[-1] == "postgres:16" and self.failures:
                raise ci.PullFailure(self.failures.pop(0))
            if args[-1] != "postgres:16" and self.mirror_failure:
                raise ci.PullFailure("quota")
        if args[:2] == ("image", "inspect"):
            return json.dumps([{"Id": self.tag_id if args[-1] == "postgres:16" else IMAGE_ID,
                                "Os": "linux", "Architecture": self.arch}])
        return ""


class PullTests(unittest.TestCase):
    def install(self, docker, registry=None):
        delays = []
        registry = registry or FakeRegistry()
        ci.install(docker, registry, delays.append)
        return registry, delays

    def test_primary_success_never_contacts_mirror(self):
        docker = FakeDocker()
        registry, delays = self.install(docker)
        self.assertEqual(registry.calls, [])
        self.assertEqual(delays, [])
        self.assertEqual(docker.calls[0], ("pull", "--platform", "linux/amd64", "postgres:16"))
        self.assertFalse(any(c[0] == "tag" for c in docker.calls))

    def test_quota_immediately_verifies_and_pulls_immutable_mirror(self):
        docker = FakeDocker(["quota"])
        registry, delays = self.install(docker)
        pulls = [c for c in docker.calls if c[0] == "pull"]
        expected = f"public.ecr.aws/docker/library/postgres@{ci.digest(registry.child)}"
        self.assertEqual(pulls, [("pull", "--platform", "linux/amd64", "postgres:16"),
                                 ("pull", "--platform", "linux/amd64", expected)])
        self.assertIn(("tag", expected, "postgres:16"), docker.calls)
        self.assertEqual(delays, [])
        self.assertEqual([c[3] for c in registry.calls if c[0] == ci.HUB], ["HEAD", "HEAD"])

    def test_transient_retry_can_recover_primary(self):
        docker = FakeDocker(["transient", "transient"])
        registry, delays = self.install(docker)
        self.assertEqual(delays, [5, 15])
        self.assertEqual(registry.calls, [])
        self.assertEqual(len([c for c in docker.calls if c[0] == "pull"]), 3)

    def test_exhausted_transient_retries_use_verified_fallback(self):
        docker = FakeDocker(["transient"] * 3)
        _, delays = self.install(docker)
        self.assertEqual(delays, [5, 15])
        self.assertEqual(len([c for c in docker.calls if c[0] == "pull"]), 4)

    def test_terminal_failure_never_falls_back(self):
        docker, registry = FakeDocker(["terminal"]), FakeRegistry()
        with self.assertRaises(ci.PullFailure):
            self.install(docker, registry)
        self.assertEqual(registry.calls, [])
        self.assertEqual(len(docker.calls), 1)

    def test_mirror_quota_fails_without_retagging(self):
        docker = FakeDocker(["quota"])
        docker.mirror_failure = True
        with self.assertRaises(ci.PullFailure):
            self.install(docker)
        self.assertFalse(any(c[0] == "tag" for c in docker.calls))

    def test_mismatch_drift_corruption_and_duplicate_platform_fail_before_mirror_pull(self):
        for failure in ("mismatch", "drift", "corrupt_child", "duplicate", "missing", "header", "size"):
            with self.subTest(failure=failure):
                registry, docker = FakeRegistry(), FakeDocker(["quota"])
                if failure in ("mismatch", "drift", "corrupt_child"):
                    setattr(registry, failure, True)
                elif failure == "duplicate":
                    registry.index["manifests"].append(dict(registry.entry))
                elif failure == "missing":
                    registry.index["manifests"] = []
                elif failure == "header":
                    registry.header = IMAGE_ID
                elif failure == "size":
                    registry.entry["size"] += 1
                with self.assertRaises(RuntimeError):
                    self.install(docker, registry)
                self.assertEqual(len(docker.calls), 1)

    def test_unavailable_head_fails_closed(self):
        registry, docker = FakeRegistry(), FakeDocker(["quota"])
        registry.manifest = lambda *args: (_ for _ in ()).throw(OSError("unavailable"))
        with self.assertRaises(OSError):
            self.install(docker, registry)
        self.assertEqual(len(docker.calls), 1)

    def test_wrong_architecture_never_retags(self):
        docker = FakeDocker(["quota"])
        docker.arch = "arm64"
        with self.assertRaises(RuntimeError):
            self.install(docker)
        self.assertFalse(any(c[0] == "tag" for c in docker.calls))

    def test_tag_identity_is_checked(self):
        docker = FakeDocker(["quota"])
        docker.tag_id = "sha256:" + "2" * 64
        with self.assertRaises(RuntimeError):
            self.install(docker)

    def test_local_execution_refused_before_any_docker_or_http(self):
        with patch.dict(ci.os.environ, {}, clear=True), patch.object(ci, "Docker") as docker, patch.object(ci, "Registry") as registry:
            with self.assertRaises(RuntimeError):
                ci.main()
            docker.assert_not_called()
            registry.assert_not_called()

    def test_mirror_transient_retries_are_also_bounded(self):
        calls, delays = [], []
        def run(*args):
            calls.append(args)
            raise ci.PullFailure("transient")
        with self.assertRaises(ci.PullFailure):
            ci.pull(run, "public.ecr.aws/docker/library/postgres@" + IMAGE_ID, delays.append)
        self.assertEqual(len(calls), 3)
        self.assertEqual(delays, [5, 15])

    def test_invalid_descriptor_fails_closed(self):
        for value in (None, {}, {"digest": 42, "size": 10},
                      {"digest": IMAGE_ID, "size": True}, {"digest": IMAGE_ID, "size": -1}):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                ci.descriptor(value)

    def test_docker_uses_empty_config_explicit_runner_socket_and_clean_environment(self):
        child = Mock(pid=999999)
        child.wait.return_value = 0
        with patch.dict(ci.os.environ, {"PATH": "/ci/bin", "AWS_SECRET_ACCESS_KEY": "unused", "DOCKER_HOST": "unused"}), \
                patch.object(ci.subprocess, "Popen", return_value=child) as popen:
            docker = ci.Docker("/tmp/empty-ci-config")
            docker("pull", "--platform", "linux/amd64", "postgres:16")
        self.assertEqual(popen.call_args.args[0][:5], ["docker", "--config", "/tmp/empty-ci-config",
                                                      "--host", "unix:///var/run/docker.sock"])
        self.assertEqual(popen.call_args.kwargs["env"], {"PATH": "/ci/bin", "HOME": "/tmp/empty-ci-config",
                                                        "DOCKER_CONFIG": "/tmp/empty-ci-config"})
        child.wait.assert_called_once_with(timeout=180)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_docker_pull_timeout_kills_only_its_process_group_and_reaps_child(self):
        child = Mock(pid=999999)
        child.wait.side_effect = [ci.subprocess.TimeoutExpired("docker", 180), 0]
        with patch.object(ci.subprocess, "Popen", return_value=child), patch.object(ci.os, "killpg") as kill:
            with self.assertRaises(ci.PullFailure) as error:
                ci.Docker("/tmp/empty-ci-config")("pull", "postgres:16")
        self.assertEqual(error.exception.kind, "transient")
        kill.assert_called_once_with(child.pid, ci.signal.SIGKILL)
        self.assertEqual(child.wait.call_count, 2)

    def test_registry_does_not_follow_redirects(self):
        self.assertIsNone(ci.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://example.com"))

    def test_error_classification(self):
        for text in ("toomanyrequests: unauthenticated pull rate limit", "429 Too Many Requests"):
            self.assertEqual(ci.classify(text), "quota")
        for text in ("TLS handshake timeout", "connection reset by peer", "503 Service Unavailable"):
            self.assertEqual(ci.classify(text), "transient")
        for text in ("manifest unknown", "unauthorized", "permission denied", "no space left on device", "manifest sha256:abc500def429abc unknown"):
            self.assertEqual(ci.classify(text), "terminal")


if __name__ == "__main__":
    unittest.main()
