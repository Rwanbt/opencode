#!/usr/bin/env python3
"""Helper script for wf-test.sh — parses a GitHub Actions workflow and prints summary"""
import sys
import yaml

if len(sys.argv) < 2:
    print("Usage: wf-parse.py <workflow.yml>")
    sys.exit(1)

wf = sys.argv[1]
try:
    with open(wf) as f:
        d = yaml.safe_load(f)

    name = d.get("name", "<unnamed>")
    on = d.get("on") or d.get(True)
    if isinstance(on, dict):
        triggers = ", ".join(on.keys())
    elif isinstance(on, str):
        triggers = on
    else:
        triggers = "complex"

    jobs = d.get("jobs", {})
    total_steps = sum(len(j.get("steps", [])) for j in jobs.values())

    print(f"name: {name}")
    print(f"triggers: {triggers}")
    print(f"jobs: {list(jobs.keys())}")
    print(f"total steps: {total_steps}")
except Exception as e:
    print(f"error: {e}")
    sys.exit(1)
