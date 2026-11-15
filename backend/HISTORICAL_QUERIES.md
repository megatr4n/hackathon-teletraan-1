# FIRMS historical query storage

Uvicorn workers share query metadata through a local directory. By default the
API uses `teletraan-firms-queries` in Python's system temporary directory. Set
`FIRMS_QUERY_DIR` to an absolute directory to choose its location. Point every
worker to the same writable directory on the server. Keep this state separate
from the read-only FIRMS release. Independent hosts with separate filesystems
need request affinity.

Query IDs expire after two hours. When a worker serves a different release or
geometry version, clients receive HTTP 410 and must create the query again.
