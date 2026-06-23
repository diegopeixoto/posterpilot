# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately through one of:

- **GitHub private advisory** — open a draft advisory at
  `https://github.com/diegopeixoto/posterpilot/security/advisories/new`
  (Security → Advisories → Report a vulnerability).
- **Email** — diego@aquarela.io

Include a description, reproduction steps, affected version/commit, and impact.

You can expect an acknowledgement within a few days. Once the issue is confirmed
and a fix is available, we will coordinate disclosure and credit you (unless you
prefer to remain anonymous).

## Scope

PosterPilot is a self-hosted application that holds credentials for your media
server (Plex/Jellyfin/Emby) and TMDB. Reports affecting the confidentiality of
those credentials, the SQLite database, or remote code execution are especially
important.

## Supported Versions

Security fixes target the latest released version on the `main` branch.
