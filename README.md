# Safenet daily snapshots: the index

`index.json` maps each UTC day to the CID of that day's snapshot of the Safenet validator
dataset. `INDEX_CID` is the CID this `index.json` is pinned under. Each index names the
CID of the one before it in `previous`, so the pinned versions form a chain.

The snapshots workflow writes this branch. The schema, and how to verify a snapshot
without our infrastructure, are in `packages/snapshots/README.md` on `main`.
