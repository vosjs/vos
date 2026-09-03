# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Report it privately through [GitHub Security Advisories](https://github.com/vosjs/vos/security/advisories/new). You will get an acknowledgement within a few days and updates until a fix ships.

## Scope

`@vosjs/core` compiles untrusted configs, including function strings, into executable program code, and `@vosjs/core/runtime` wraps that code into a page meant to run inside a sandboxed iframe or a headless browser. In scope:

- compiled output escaping the render sandbox, reading host data, or executing outside the render page
- the `vos` CLI writing outside the take directory it was pointed at, or sending a credential anywhere but the configured origin
- a schema or lint bypass that lets a config claim to be deterministic while it is not

Out of scope: the content of a config you chose to run (a program can draw anything), and issues in the hosted platform at vos.so, which has its own reporting path.

## Supported versions

Pre-1.0: only the latest published version of each package receives security fixes.
