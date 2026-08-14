#!/usr/bin/env node
/**
 * ds-web-ui jsonrpc runtime launcher (Node, Windows-compatible).
 *
 * Executes the official @deepseek-ai stdio JSON-RPC agent bin as a side
 * effect — the same composition the Python SDK's dsh-jsonrpc-agent
 * single-file runtime uses, implemented in pure Node so it runs on Windows.
 *
 * Usage: node dsh-jsonrpc-agent-launcher.js <path/to/cordis.yml>
 *        (or set DSH_CORDIS_CONFIG=<path>, which wins)
 */
import "@deepseek-ai/dsh-sdk-jsonrpc-demo/bin";
