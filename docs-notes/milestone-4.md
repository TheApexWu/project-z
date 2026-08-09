# Milestone 4

- `server/orders.go` owns persisted deadlines and all valid lifecycle transitions; the ticker resumes deadline work after restart.
- Local restart check: order `0181c5e2-1959-437e-85a8-3c1069a50ffd` used a 1-minute timer, survived a mid-timer process kill/restart, then reported `GRACE` and `MINTING` after its persisted deadlines.
- The temporary local server was stopped and both restart-check orders were cancelled, so later minting work cannot act on test data.
