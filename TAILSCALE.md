# Tailscale setup

Publish this lobby from the machine that will stay on during the game. Use Git Bash in this directory.

- Install Tailscale, log in, and leave it connected.
- Run `./lobby-host.sh start`.
- If it prints a `https://login.tailscale.com/...` link, open it and approve Funnel, HTTPS certificates, and MagicDNS, then run `./lobby-host.sh start` again.
- Give guests the printed `https://….ts.net` URL. They enter a name and join with the host's 4-letter room code.
- When the game is over, run `./lobby-host.sh stop`.

The machine has to stay awake. The script only publishes `127.0.0.1:7105`, and it leaves Funnel alone if something else is already published.
