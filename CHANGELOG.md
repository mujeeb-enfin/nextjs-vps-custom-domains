# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-23

### Added

- Tenant custom domains: CNAME routing to a platform hostname plus a TXT ownership record.
- DNS verification against public resolvers, with CNAME flattening, proxied-record detection, AAAA and CAA checks.
- Hostname validation with IDN, public-suffix and look-alike protection.
- REST API, Server-Sent Events status stream and a dashboard UI.
- Host agent (`agent/`) provisioning nginx vhosts and Let's Encrypt certificates through a single validated sudo wrapper, with automatic renewal and DNS re-checks.
- Docker image, Docker Compose stack, deployment guide for VPS, AWS, Azure and GCP.
