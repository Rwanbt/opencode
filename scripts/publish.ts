#!/usr/bin/env bun

import { $ } from "bun"

import pkg from "../package.json"

const version = process.env["VERSION"]

await import("./stainless.ts")
