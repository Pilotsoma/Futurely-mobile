// API base URL for the NextStep backend.
//
// Local dev (physical device with Expo Go):
// - Use the IP address of the COMPUTER running the backend (port 3001 = Express directly, no /api prefix).
// - The phone and computer must be on the same network.
// - Test from the phone browser first: http://192.168.40.75:3001/health
//
// Android Emulator:
// export const API_BASE_URL = 'http://10.0.2.2:3001'
//
// iOS Simulator:
// export const API_BASE_URL = 'http://localhost:3001'
//
// Production (Vercel — Express served at /api via vercel.json rewrite):
// export const API_BASE_URL = 'https://your-app.vercel.app/api'

export const API_BASE_URL = 'http://192.168.40.75:3001'
