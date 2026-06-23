# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/vosjs/vos/security/advisories/new), or email the maintainer. We will acknowledge receipt within a few days and keep you updated on the fix.

## Scope

`@vosjs/core` compiles untrusted config (including function strings) into executable template code. If you find a way for compiled output to escape its intended sandbox, leak host data, or execute code outside the render iframe, that is in scope.

## Supported versions

As a pre-1.0 project, only the latest published version receives security fixes.
