# PICO 4 VR Manager

## Overview
Application for managing and monitoring 5 PICO 4 VR headsets from a tablet over a local network (no internet required).

### Features
- **Device Discovery** - Automatic scanning of local network for PICO 4 headsets
- **Screen Mirroring** - Live view of all 5 headsets simultaneously on the tablet
- **Content Control** - Launch/stop apps on any or all headsets
- **Bulk Operations** - Control all headsets at once (volume, apps, etc.)
- **Device Monitoring** - Battery level, connection status, current app

---

## Requirements
- **Node.js** 18+
- **ADB** (Android Debug Bridge)
- **PICO 4** headsets with Developer Mode enabled
- All devices on the **same local WiFi network**

## Quick Start

```bash
# 1. Setup
chmod +x setup.sh
./setup.sh

# 2. Start
npm start

# 3. Open in tablet browser
# http://<server-ip>:3000
```

## PICO 4 Preparation

On each PICO 4 headset:

1. Go to **Settings > General > Developer**
2. Enable **USB Debugging**
3. Enable **Wireless Debugging** (ADB over WiFi)
4. Note the IP address shown in **Settings > WiFi**
5. Connect to the same WiFi network as the tablet

## Architecture

```
┌─────────────┐    WiFi (LAN)    ┌──────────────┐
│   Tablet    │◄────────────────►│  Node.js     │
│   Browser   │   HTTP/WebSocket │  Server      │
└─────────────┘                  └──────┬───────┘
                                        │ ADB over TCP
                    ┌───────────────────┼───────────────────┐
                    │           │       │       │           │
              ┌─────┴─┐  ┌─────┴─┐ ┌───┴───┐ ┌─┴─────┐ ┌──┴────┐
              │PICO #1│  │PICO #2│ │PICO #3│ │PICO #4│ │PICO #5│
              └───────┘  └───────┘ └───────┘ └───────┘ └───────┘
```

## API Reference

### Devices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices |
| POST | `/api/devices/scan` | Scan network for devices |
| POST | `/api/devices/:ip/connect` | Connect to device |
| POST | `/api/devices/:ip/disconnect` | Disconnect device |
| GET | `/api/devices/:ip/info` | Get device details |
| GET | `/api/devices/:ip/screenshot` | Get single screenshot |
| GET | `/api/devices/:ip/apps` | List installed apps |

### Control
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/devices/:ip/launch` | `{packageName}` | Launch app |
| POST | `/api/devices/:ip/stop` | `{packageName}` | Stop app |
| POST | `/api/devices/:ip/volume` | `{level: 0-15}` | Set volume |
| POST | `/api/devices/:ip/brightness` | `{level: 0-255}` | Set brightness |
| POST | `/api/devices/:ip/reboot` | - | Reboot device |

### Bulk Operations
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/all/launch` | `{packageName}` | Launch on all |
| POST | `/api/all/stop` | `{packageName}` | Stop on all |
| POST | `/api/all/volume` | `{level}` | Set volume on all |

### WebSocket (`/ws`)
| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `start_stream` | Client→Server | Start screen mirroring `{ip, fps}` |
| `stop_stream` | Client→Server | Stop mirroring `{ip}` |
| `start_all_streams` | Client→Server | Mirror all `{fps}` |
| `frame` | Server→Client | Screenshot frame `{ip, data}` |
| `device_status` | Server→Client | Status updates |
