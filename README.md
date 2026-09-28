# ESC/POS Emulator

Virtual thermal printer for development and testing. Send the same ESC/POS stream you would send to a network printer on port **9100**, and the receipt appears in the browser in real time.

## What it does

- Listens for raw TCP in the JetDirect/AppSocket style (**port 9100**)
- Renders a receipt preview (text, formatting, images, cut, and more)
- Shows the decoded ESC/POS command list
- Answers status probes (`DLE EOT`), common in mobile printing apps
- Supports **58 mm** and **80 mm** paper
- Runs entirely on Node.js (web UI and TCP in the same process)

## Online usage

1. Open the web UI on the application domain.
2. Check the **Printer** panel for the TCP address (IP/host + port **9100**).
3. In your app/POS, set the network printer to that host on port **9100**.
4. Print as usual: the receipt should show up in the preview.

## Local usage

Requirements: **Node.js 18+**.

```bash
npm install
npm start
```

This starts:

| Service | Address |
|---------|---------|
| Web UI | http://localhost:3000 |
| TCP printer | `localhost:9100` (also bound to `0.0.0.0` on the LAN) |

Open the UI, point your app at the machine IP on port 9100, and print. On the same machine:

```bash
npm run sample
```

### Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Bind interface |
| `HTTP_PORT` / `PORT` | `3000` | Web UI port |
| `TCP_PORT` | `9100` | ESC/POS port |
| `PAPER_WIDTH` | `80` | `58` or `80` |
| `JOB_IDLE_MS` | `350` | Idle time before closing a job on an open TCP connection |
| `DEFAULT_CODEPAGE` / `FORCE_CODEPAGE` | `windows-1252` | Text encoding (many BR apps send 1252 even with `ESC t` for CP850/860) |

Example:

```bash
HTTP_PORT=8080 TCP_PORT=9100 PAPER_WIDTH=58 npm start
```

## Docker

```bash
docker compose up -d --build
```

- UI: http://localhost:3000  
- TCP: port **9100** on the host  

## Quick API

- `GET /api/status`: state, jobs, and stats  
- `DELETE /api/jobs`: clear the preview  
- `POST /api/print`: send hex/base64/text without TCP  
- `PATCH /api/printer`: `{ "paperWidthMm": 58 | 80 }`  
- WebSocket `/ws`: live preview updates  

## License

MIT. See [LICENSE](LICENSE).
