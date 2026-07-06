// API_BASE_URL — hardcoded per-developer (accepted pattern in this project).
//
// Physical device via Expo Go:  your machine's LAN IP, e.g. 'http://192.168.40.75:3001'
// Android emulator:             'http://10.0.2.2:3001'
// iOS simulator:                'http://localhost:3001'
//
// This is the #1 reason the mobile app can't reach the backend.
// Edit this constant locally and do NOT commit your personal IP.
//
// NOTE: temporarily pointed at port 49329, not the default 3001 — port 3001 was
// occupied by a stray leftover process during this dev session, so the backend's
// preview server auto-assigned a different port. Change this back to 3001 (or
// your LAN IP :3001) once you're running your own backend normally.
//
// Set to this machine's LAN IP (not localhost) for physical-device/Expo Go testing.

export const API_BASE_URL = 'http://192.168.40.75:49329'
